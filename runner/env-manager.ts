/**
 * Isolated environment manager for parallel demo recordings.
 *
 * Spins up a dedicated Supabase + Next.js stack per recording so multiple
 * demos can run concurrently without port conflicts or data races.
 *
 * Performance optimizations:
 * - Excludes unused Supabase services (studio, imgproxy, edge-runtime, etc.)
 * - Parallelizes seed data + Next.js startup; auth chains after seed
 * - Generates auth tokens via Supabase API instead of Playwright (no browser needed)
 *
 * Includes a registry/reaper system: each isolated env writes a lock file.
 * On startup, stale entries (whose Docker containers are no longer running)
 * are reaped automatically. A standalone `cleanupAllIsolatedEnvs()` function
 * provides a manual escape hatch.
 */

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { AUTH_PROFILES, buildSupabaseStorageKey } from './auth-profiles.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directory where PID lock files are written for registry/reaper. */
const REGISTRY_DIR = path.join(os.tmpdir(), 'demo-recorder-registry');

/** Prefix for isolated env temp directories. */
const ENV_DIR_PREFIX = 'demo-env-';

/** Prefix for Supabase project IDs created by this manager. */
const PROJECT_ID_PREFIX = 'demo-';

/**
 * Supabase services to exclude from isolated environments.
 * Demos only need: postgres, gotrue (auth), postgrest (API), kong (gateway),
 * and realtime. Everything else is overhead.
 */
const EXCLUDED_SERVICES = [
  'studio',
  'storage-api',
  'imgproxy',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
  'postgres-meta',
];

// ---------------------------------------------------------------------------
// Port allocation
// ---------------------------------------------------------------------------

/**
 * Check whether a single TCP port is available.
 * Checks both 0.0.0.0 and 127.0.0.1 because Docker binds on 0.0.0.0
 * while Node defaults to 127.0.0.1. A port bound on 0.0.0.0 by Docker
 * appears free when only checking 127.0.0.1.
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => {
        // Double-check on 127.0.0.1 as well
        const srv2 = net.createServer();
        srv2.once('error', () => resolve(false));
        srv2.once('listening', () => {
          srv2.close(() => resolve(true));
        });
        srv2.listen(port, '127.0.0.1');
      });
    });
    srv.listen(port, '0.0.0.0');
  });
}

/** Path for atomic port lock files. */
function portLockPath(base: number): string {
  return path.join(REGISTRY_DIR, `port-${base}.lock`);
}

/**
 * Atomically claim a port block by creating an exclusive lock file.
 * Returns true if the lock was acquired, false if another process already holds it.
 */
function tryClaimPortBlock(base: number, projectId: string): boolean {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  try {
    fs.writeFileSync(portLockPath(base), JSON.stringify({ projectId, pid: process.pid }), {
      flag: 'wx',
    });
    return true;
  } catch {
    return false;
  }
}

/** Release a port block lock file. */
function releasePortLock(base: number): void {
  try {
    fs.unlinkSync(portLockPath(base));
  } catch {
    // Already removed
  }
}

/**
 * Find a contiguous block of free ports with atomic reservation.
 *
 * The block size is `count + 1` because the port map uses `base - 1` for
 * the shadow DB. We scan [base - 1, base, base + 1, ..., base + count - 1].
 *
 * Uses random jitter on the start port so concurrent agents don't all begin
 * scanning from the same position, and an atomic lock file (O_CREAT | O_EXCL)
 * to prevent TOCTOU races where two agents see the same ports as free.
 */
async function findAvailablePortBlock(
  count: number,
  startFrom = 55000,
  projectId = ''
): Promise<number> {
  const ceiling = 65000;
  // Add random jitter (0-999) so concurrent agents start scanning at different positions
  const jitter = Math.floor(Math.random() * 1000);
  let base = startFrom + jitter;

  while (base + count < ceiling) {
    let collision = -1;
    // Check base - 1 (shadowDb) through base + count - 1
    for (let offset = -1; offset < count; offset++) {
      const port = base + offset;
      if (!(await isPortFree(port))) {
        collision = offset;
        break;
      }
    }
    if (collision === -1) {
      // Ports are free; atomically claim them via lock file
      if (tryClaimPortBlock(base, projectId)) return base;
      // Another agent claimed this block between our scan and lock attempt
      base += count + 2;
      continue;
    }
    // Jump past the collision: next candidate starts after the blocked port
    base = base + collision + 2;
  }

  throw new Error(`Could not find ${count + 1} consecutive free ports below ${ceiling}`);
}

// ---------------------------------------------------------------------------
// Config rewriting
// ---------------------------------------------------------------------------

/** Port mapping from a base port to Supabase service ports. */
interface PortMap {
  api: number;
  db: number;
  studio: number;
  inbucket: number;
  analytics: number;
  pooler: number;
  edgeRuntime: number;
  shadowDb: number;
  nextJs: number;
}

function portMapFromBase(base: number): PortMap {
  return {
    api: base,
    db: base + 1,
    studio: base + 2,
    inbucket: base + 3,
    analytics: base + 6,
    pooler: base + 8,
    edgeRuntime: base + 9,
    shadowDb: base - 1,
    nextJs: base + 10,
  };
}

/**
 * Rewrite config.toml with a new project_id and port assignments.
 * Uses simple string replacement rather than a TOML parser to avoid
 * adding a dependency.
 */
function rewriteConfig(original: string, projectId: string, ports: PortMap): string {
  let config = original;

  config = config.replace(/^project_id\s*=\s*"[^"]*"/m, `project_id = "${projectId}"`);

  // [api] port
  config = config.replace(
    /(\[api\][\s\S]*?)port\s*=\s*\d+/m,
    (_match, prefix) => `${prefix}port = ${ports.api}`
  );

  // [db] port and shadow_port
  config = config.replace(
    /(\[db\][\s\S]*?)(?<=\n)port\s*=\s*\d+/m,
    (_match, prefix) => `${prefix}port = ${ports.db}`
  );
  config = config.replace(/shadow_port\s*=\s*\d+/m, `shadow_port = ${ports.shadowDb}`);

  // [db.pooler] port
  config = config.replace(
    /(\[db\.pooler\][\s\S]*?)port\s*=\s*\d+/m,
    (_match, prefix) => `${prefix}port = ${ports.pooler}`
  );

  // [studio] port
  config = config.replace(
    /(\[studio\][\s\S]*?)port\s*=\s*\d+/m,
    (_match, prefix) => `${prefix}port = ${ports.studio}`
  );

  // [studio] api_url (point to isolated API so Studio connects to the right instance)
  config = config.replace(
    /(\[studio\][\s\S]*?)api_url\s*=\s*"[^"]*"/m,
    (_match, prefix) => `${prefix}api_url = "http://127.0.0.1:${ports.api}"`
  );

  // [inbucket] port
  config = config.replace(
    /(\[inbucket\][\s\S]*?)port\s*=\s*\d+/m,
    (_match, prefix) => `${prefix}port = ${ports.inbucket}`
  );

  // [analytics] port
  config = config.replace(
    /(\[analytics\][\s\S]*?)port\s*=\s*\d+/m,
    (_match, prefix) => `${prefix}port = ${ports.analytics}`
  );

  // [edge_runtime] inspector_port
  config = config.replace(/inspector_port\s*=\s*\d+/m, `inspector_port = ${ports.edgeRuntime}`);

  // [auth] site_url and additional_redirect_urls
  // Use localhost to match the baseUrl and cookie domain used by generateAuthState.
  config = config.replace(
    /site_url\s*=\s*"http:\/\/127\.0\.0\.1:\d+"/m,
    `site_url = "http://localhost:${ports.nextJs}"`
  );
  config = config.replace(
    /additional_redirect_urls\s*=\s*\[.*?\]/m,
    `additional_redirect_urls = ["http://localhost:${ports.nextJs}"]`
  );

  return config;
}

// ---------------------------------------------------------------------------
// Supabase env parsing
// ---------------------------------------------------------------------------

interface SupabaseEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

function parseSupabaseStatus(envOutput: string): SupabaseEnv {
  const lines = envOutput.split('\n');
  const env: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (match) {
      env[match[1]] = match[2];
    }
  }

  if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
    throw new Error(
      `Failed to parse Supabase status output. Got keys: ${Object.keys(env).join(', ')}`
    );
  }

  return {
    apiUrl: env.API_URL,
    anonKey: env.ANON_KEY,
    serviceRoleKey: env.SERVICE_ROLE_KEY,
  };
}

// ---------------------------------------------------------------------------
// Process management helpers
// ---------------------------------------------------------------------------

function waitForUrl(url: string, timeoutMs = 120_000, intervalMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const check = () => {
      fetch(url, { signal: AbortSignal.timeout(3000) })
        .then((res) => {
          if (res.ok || res.status < 500) {
            resolve();
          } else if (Date.now() > deadline) {
            reject(new Error(`Timeout waiting for ${url} (last status: ${res.status})`));
          } else {
            setTimeout(check, intervalMs);
          }
        })
        .catch(() => {
          if (Date.now() > deadline) {
            reject(new Error(`Timeout waiting for ${url}`));
          } else {
            setTimeout(check, intervalMs);
          }
        });
    };

    check();
  });
}

function killProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!child.pid || child.exitCode !== null) {
      resolve();
      return;
    }

    child.once('exit', () => resolve());
    child.kill('SIGTERM');

    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 5000);
  });
}

// ---------------------------------------------------------------------------
// Auth state generation via Supabase API (replaces Playwright login flow)
// ---------------------------------------------------------------------------

/**
 * Generate Playwright-compatible auth storage state by signing in via the
 * Supabase GoTrue API directly. This avoids launching a browser, saving ~15s.
 *
 * The storage state format matches what Playwright's `storageState()` produces:
 * `{ cookies: [{ name, value, domain, ... }], origins: [] }`
 *
 * Uses cookie-based auth (not localStorage) because @supabase/ssr reads
 * the session from cookies for SSR pages.
 */
async function generateAuthState(
  supabaseEnv: SupabaseEnv,
  authProfile: string,
  outputPath: string,
  baseUrl: string
): Promise<void> {
  const creds = AUTH_PROFILES[authProfile];
  if (!creds) {
    console.warn(`  [auth] Unknown profile "${authProfile}", skipping auth generation.`);
    return;
  }

  console.log(`  [auth] Signing in as ${creds.email} via Supabase API...`);

  try {
    // Sign in via GoTrue REST API
    const res = await fetch(`${supabaseEnv.apiUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseEnv.anonKey,
      },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`  [auth] Sign-in failed (${res.status}): ${body}`);
      return;
    }

    const session = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      token_type: string;
      user: { id: string };
    };

    // Build Playwright-compatible storage state.
    // @supabase/ssr stores the session in an HTTP cookie (not localStorage).
    // The cookie name is derived from the project URL.
    const storageKey = buildSupabaseStorageKey(supabaseEnv.apiUrl);
    const storageValue = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      token_type: session.token_type,
      user: session.user,
    });

    // Encode as base64url cookie value (matching @supabase/ssr cookie format).
    // @supabase/ssr defaults to cookieEncoding: "base64url" and uses its own
    // stringFromBase64URL decoder, which rejects standard base64 characters (+/).
    const cookieValue = `base64-${Buffer.from(storageValue).toString('base64url')}`;

    // Parse the base URL for cookie properties.
    // Use 'localhost' instead of '127.0.0.1' for cookie domain because
    // some browsers and Playwright handle IP address cookie domains inconsistently.
    const baseUrlParsed = new URL(baseUrl);
    // Rewrite base URL to use localhost if it was 127.0.0.1
    const effectiveBaseUrl = baseUrl.replace('127.0.0.1', 'localhost');

    const storageState = {
      cookies: [
        {
          name: storageKey,
          value: cookieValue,
          // Use the full URL instead of bare domain. Playwright's Chromium handles
          // localhost cookie domains inconsistently when set via domain alone.
          // Setting via url lets the browser derive the correct host-only domain.
          // Note: url and path are mutually exclusive in Playwright's addCookies.
          url: effectiveBaseUrl,
          expires: (session.expires_at ?? Math.floor(Date.now() / 1000)) + 86400,
          httpOnly: false,
          secure: baseUrlParsed.protocol === 'https:',
          sameSite: 'Lax' as const,
        },
      ],
      origins: [
        {
          origin: effectiveBaseUrl,
          localStorage: [{ name: storageKey, value: storageValue }],
        },
      ],
    };

    fs.writeFileSync(outputPath, JSON.stringify(storageState, null, 2));
    console.log(`  [auth] Auth state written for ${authProfile}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [auth] Auth generation failed: ${msg}`);
  }
}

/** Maximum age (ms) before an environment is force-reaped regardless of Docker state. */
const MAX_ENV_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Check whether an isolated environment is still alive by inspecting its
 * Docker containers. Uses a broad filter matching any container with the
 * project ID in its name (not just the DB container), catching cases where
 * the DB container is gone but other containers linger.
 *
 * Returns true if at least one running container matches the project ID.
 */
function isEnvAlive(projectId: string): boolean {
  try {
    const output = execFileSync(
      'docker',
      ['ps', '--filter', `name=${projectId}`, '--format', '{{.ID}}'],
      { encoding: 'utf-8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.trim().length > 0;
  } catch {
    // If docker command fails, assume alive to avoid false reaping
    return true;
  }
}

// ---------------------------------------------------------------------------
// Registry: lock files for reaping orphaned environments
// ---------------------------------------------------------------------------

interface RegistryEntry {
  pid: number;
  projectId: string;
  tmpRoot: string;
  createdAt: string;
}

function registryPath(projectId: string): string {
  return path.join(REGISTRY_DIR, `${projectId}.json`);
}

function registerEnv(entry: RegistryEntry): void {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.writeFileSync(registryPath(entry.projectId), JSON.stringify(entry));
}

function unregisterEnv(projectId: string): void {
  try {
    fs.unlinkSync(registryPath(projectId));
  } catch {
    // Already removed
  }
}

/** Stop a Supabase project by its workdir or project ID. */
function stopSupabaseProject(tmpRoot: string, projectId: string): void {
  try {
    execFileSync('npx', ['supabase', 'stop', '--workdir', tmpRoot, '--no-backup'], {
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch {
    try {
      execFileSync('npx', ['supabase', 'stop', '--project-id', projectId, '--no-backup'], {
        stdio: 'pipe',
        timeout: 30_000,
      });
    } catch {
      // Best-effort; the project may already be stopped
    }
  }
}

/**
 * Scan the registry for orphaned environments and clean them up.
 * Uses Docker container liveness (not PID checks) to determine if an
 * environment is still active, making it safe for parallel agent runs.
 *
 * Also force-reaps environments older than MAX_ENV_AGE_MS (30 min) and
 * cleans up stale port lock files whose owning project no longer exists.
 */
export function reapStaleEnvironments(): void {
  if (!fs.existsSync(REGISTRY_DIR)) return;

  const now = Date.now();
  const activeProjectIds = new Set<string>();

  const files = fs.readdirSync(REGISTRY_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(REGISTRY_DIR, file), 'utf-8');
      const entry: RegistryEntry = JSON.parse(raw);

      const age = now - new Date(entry.createdAt).getTime();
      const tooOld = age > MAX_ENV_AGE_MS;
      const pidAlive = isPidAlive(entry.pid);

      if (!tooOld && pidAlive) {
        activeProjectIds.add(entry.projectId);
        continue;
      }

      const dockerAlive = isEnvAlive(entry.projectId);
      const reason = tooOld
        ? `older than ${MAX_ENV_AGE_MS / 60_000}min`
        : dockerAlive
          ? 'owning process dead but Docker containers still running'
          : 'no running Docker containers';
      console.log(`  [reaper] Found orphaned env: ${entry.projectId} (${reason})`);

      stopSupabaseProject(entry.tmpRoot, entry.projectId);

      try {
        fs.rmSync(entry.tmpRoot, { recursive: true, force: true });
      } catch {
        // Best-effort
      }

      unregisterEnv(entry.projectId);
      console.log(`  [reaper] Cleaned up ${entry.projectId}.`);
    } catch {
      // Skip malformed entries
    }
  }

  // Clean up stale port lock files whose owning project is no longer registered
  try {
    const lockFiles = fs
      .readdirSync(REGISTRY_DIR)
      .filter((f) => f.startsWith('port-') && f.endsWith('.lock'));
    for (const lockFile of lockFiles) {
      try {
        const raw = fs.readFileSync(path.join(REGISTRY_DIR, lockFile), 'utf-8');
        const lock = JSON.parse(raw) as { projectId?: string };
        if (lock.projectId && !activeProjectIds.has(lock.projectId)) {
          fs.unlinkSync(path.join(REGISTRY_DIR, lockFile));
        }
      } catch {
        // Malformed lock file; remove it
        try {
          fs.unlinkSync(path.join(REGISTRY_DIR, lockFile));
        } catch {
          // Best-effort
        }
      }
    }
  } catch {
    // Best-effort
  }
}

/** Check if a process with the given PID is still alive. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 tests existence without killing
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop ALL demo-recorder isolated environments, regardless of PID status.
 * This is the "nuclear option" for manual cleanup.
 */
export function cleanupAllIsolatedEnvs(): void {
  console.log('Cleaning up all demo-recorder isolated environments...\n');

  // 1. Clean up registered environments
  if (fs.existsSync(REGISTRY_DIR)) {
    const files = fs.readdirSync(REGISTRY_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(REGISTRY_DIR, file), 'utf-8');
        const entry: RegistryEntry = JSON.parse(raw);
        console.log(`  Stopping ${entry.projectId}...`);
        stopSupabaseProject(entry.tmpRoot, entry.projectId);
        fs.rmSync(entry.tmpRoot, { recursive: true, force: true });
        unregisterEnv(entry.projectId);
        console.log(`  Cleaned up ${entry.projectId}.`);
      } catch {
        // Skip malformed entries
      }
    }
  }

  // 2. Scan tmpdir for any unregistered demo-env-* directories
  const tmpDir = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpDir);
    for (const name of entries) {
      if (!name.startsWith(ENV_DIR_PREFIX)) continue;
      const dirPath = path.join(tmpDir, name);
      const projectId = name.replace(ENV_DIR_PREFIX, '');
      if (!projectId.startsWith(PROJECT_ID_PREFIX)) continue;

      console.log(`  Found unregistered env dir: ${name}`);
      stopSupabaseProject(dirPath, projectId);
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`  Removed ${dirPath}.`);
    }
  } catch {
    // tmpdir scan is best-effort
  }

  // 3. Remove all port lock files
  try {
    const lockFiles = fs
      .readdirSync(REGISTRY_DIR)
      .filter((f) => f.startsWith('port-') && f.endsWith('.lock'));
    for (const lockFile of lockFiles) {
      try {
        fs.unlinkSync(path.join(REGISTRY_DIR, lockFile));
      } catch {
        // Best-effort
      }
    }
  } catch {
    // Best-effort
  }

  console.log('\nDone.');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface IsolatedEnv {
  baseUrl: string;
  authStatePath: string;
  cleanup: () => Promise<void>;
}

export interface CreateIsolatedEnvOptions {
  /** Path to the web/ directory containing supabase/ config. */
  webDir: string;
  /** Auth profile name (default: 'ownerUser'). */
  authProfile?: string;
}

export async function createIsolatedEnv(options: CreateIsolatedEnvOptions): Promise<IsolatedEnv> {
  const { webDir, authProfile = 'ownerUser' } = options;
  const projectId = `${PROJECT_ID_PREFIX}${randomBytes(4).toString('hex')}`;
  const tmpRoot = path.join(os.tmpdir(), `${ENV_DIR_PREFIX}${projectId}`);
  const supabaseDir = path.join(tmpRoot, 'supabase');

  console.log(`  [env] Project ID: ${projectId}`);
  console.log(`  [env] Temp dir: ${tmpRoot}`);

  // Reap any orphaned environments from previous crashed runs
  reapStaleEnvironments();

  // 1. Allocate ports (with atomic lock to prevent races between concurrent agents)
  console.log('  [env] Finding available ports...');
  const basePort = await findAvailablePortBlock(11, 55000, projectId);
  const ports = portMapFromBase(basePort);
  console.log(`  [env] Ports allocated: API=${ports.api}, DB=${ports.db}, Next.js=${ports.nextJs}`);

  // 2. Create temp directory structure
  fs.mkdirSync(supabaseDir, { recursive: true });

  // 3. Register this environment so the reaper can clean it up if we crash
  registerEnv({
    pid: process.pid,
    projectId,
    tmpRoot,
    createdAt: new Date().toISOString(),
  });

  // 4. Rewrite config.toml
  const originalConfig = fs.readFileSync(path.join(webDir, 'supabase', 'config.toml'), 'utf-8');
  const newConfig = rewriteConfig(originalConfig, projectId, ports);
  fs.writeFileSync(path.join(supabaseDir, 'config.toml'), newConfig);

  // 5. Symlink migrations, seed, templates, and edge functions
  for (const name of ['migrations', 'seed.sql', 'templates', 'functions']) {
    const source = path.join(webDir, 'supabase', name);
    if (fs.existsSync(source)) {
      fs.symlinkSync(source, path.join(supabaseDir, name));
    }
  }

  // 6. Start Supabase (excluding unused services to save RAM and startup time)
  console.log('  [env] Starting Supabase (excluding: ' + EXCLUDED_SERVICES.join(', ') + ')...');
  try {
    execFileSync(
      'npx',
      ['supabase', 'start', '--workdir', tmpRoot, '-x', EXCLUDED_SERVICES.join(',')],
      {
        stdio: 'pipe',
        timeout: 180_000,
        cwd: webDir,
      }
    );
  } catch (err) {
    const stderr =
      err instanceof Error && 'stderr' in err ? (err as { stderr: Buffer }).stderr.toString() : '';
    throw new Error(`Failed to start Supabase for ${projectId}: ${stderr}`);
  }
  console.log('  [env] Supabase started.');

  // 7. Get connection details
  const statusOutput = execFileSync(
    'npx',
    ['supabase', 'status', '--workdir', tmpRoot, '-o', 'env'],
    { encoding: 'utf-8', cwd: webDir }
  );
  const supabaseEnv = parseSupabaseStatus(statusOutput);
  console.log(`  [env] Supabase API: ${supabaseEnv.apiUrl}`);

  // 7.5–9. Seed E2E fixtures (creates auth users), then run dev-data seed,
  //         auth token generation, and Next.js startup.
  //         E2E seed must complete first because it creates the auth users that
  //         both generateAuthState and seed-dev-data depend on.

  const supabaseSpawnEnv = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: supabaseEnv.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseEnv.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabaseEnv.serviceRoleKey,
  };

  // --- Phase A: E2E seed (creates auth users + org + clients) ---
  // Pass E2E_AUTH_PASSWORD so users are created with the same password
  // that generateAuthState will use to sign in.
  const profileCreds = AUTH_PROFILES[authProfile];
  console.log('  [env] Seeding E2E fixtures (auth users, org, clients)...');
  await new Promise<void>((resolve, reject) => {
    const e2eSeed = spawn('node', [path.join(webDir, 'scripts/seed-local-e2e.mjs')], {
      cwd: webDir,
      stdio: 'pipe',
      env: { ...supabaseSpawnEnv, E2E_AUTH_PASSWORD: profileCreds?.password ?? '' },
    });
    e2eSeed.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.log(`  [e2e-seed] ${text}`);
    });
    e2eSeed.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.log(`  [e2e-seed] ${text}`);
    });
    e2eSeed.on('close', (code) => {
      if (code === 0) {
        console.log('  [env] E2E seed complete.');
        resolve();
      } else {
        reject(
          new Error(
            `seed-local-e2e exited with code ${code}. Auth and dev-data depend on this step.`
          )
        );
      }
    });
    e2eSeed.on('error', (err) => {
      reject(new Error(`seed-local-e2e failed to start: ${err.message}`));
    });
  });

  // --- Phase B: dev-data seed + Next.js + auth tokens in parallel ---
  console.log('  [env] Starting parallel: dev-data seed + Next.js + auth tokens...');

  // --- Dev-data seed (async, non-blocking) ---
  const seedPromise = new Promise<void>((resolve) => {
    const seedProcess = spawn('npx', ['tsx', path.join(webDir, 'scripts/seed-dev-data.ts')], {
      cwd: webDir,
      stdio: 'pipe',
      env: supabaseSpawnEnv,
    });
    seedProcess.stdout?.resume();
    const seedStderr: string[] = [];
    seedProcess.stderr?.on('data', (chunk: Buffer) => {
      seedStderr.push(chunk.toString());
    });
    seedProcess.on('close', (code) => {
      if (code === 0) {
        console.log('  [env] Dev-data seed loaded.');
      } else {
        const errOutput = seedStderr.join('').trim();
        console.warn(`  [env] Warning: seed-dev-data exited with code ${code}`);
        if (errOutput) console.warn(`  [seed] ${errOutput}`);
      }
      resolve();
    });
    seedProcess.on('error', () => {
      console.warn('  [env] Warning: seed-dev-data failed to start.');
      resolve();
    });
  });

  // --- Next.js startup ---
  // Use a unique .next directory so the isolated instance doesn't conflict
  // with any existing dev server running from the same webDir.
  const isolatedNextDir = path.join(tmpRoot, '.next');
  console.log(`  [env] Starting Next.js on port ${ports.nextJs}...`);
  const nextProcess = spawn('npx', ['next', 'dev', '--webpack', '--port', String(ports.nextJs)], {
    cwd: webDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...supabaseSpawnEnv,
      PORT: String(ports.nextJs),
      NEXT_DIST_DIR: isolatedNextDir,
    },
  });

  nextProcess.stdout?.resume();
  nextProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.log(`  [next] ${text}`);
  });

  // Use localhost (not 127.0.0.1) so the browser sends the auth cookie,
  // which is set with domain=localhost in generateAuthState.
  const baseUrl = `http://localhost:${ports.nextJs}`;
  const nextReadyPromise = waitForUrl(baseUrl, 120_000).then(() => {
    console.log('  [env] Next.js ready.');
  });

  // Wait for seed + Next.js to be ready (auth depends on seed creating users)
  await Promise.all([seedPromise, nextReadyPromise]);

  // Ensure the seeded org is on the 'pro' plan so volume limits don't block demos
  try {
    const upgradeRes = await fetch(`${supabaseEnv.apiUrl}/rest/v1/organizations?select=id`, {
      headers: {
        apikey: supabaseEnv.serviceRoleKey,
        Authorization: `Bearer ${supabaseEnv.serviceRoleKey}`,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (upgradeRes.ok) {
      const orgs = (await upgradeRes.json()) as { id: string }[];
      for (const org of orgs) {
        await fetch(`${supabaseEnv.apiUrl}/rest/v1/organizations?id=eq.${org.id}`, {
          method: 'PATCH',
          headers: {
            apikey: supabaseEnv.serviceRoleKey,
            Authorization: `Bearer ${supabaseEnv.serviceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ plan: 'pro' }),
          signal: AbortSignal.timeout(5_000),
        });
      }
      console.log(`  [env] Upgraded ${orgs.length} org(s) to pro plan.`);
    }
  } catch {
    console.warn('  [env] Warning: could not upgrade org plan.');
  }

  // --- Auth token generation via Supabase API (after seed creates users) ---
  const isolatedAuthDir = path.join(tmpRoot, 'auth');
  fs.mkdirSync(isolatedAuthDir, { recursive: true });
  const isolatedAuthPath = path.join(isolatedAuthDir, `${authProfile}.json`);

  await generateAuthState(supabaseEnv, authProfile, isolatedAuthPath, baseUrl);
  if (!fs.existsSync(isolatedAuthPath)) {
    throw new Error(`Auth state was not written for profile "${authProfile}"`);
  }

  // 11. Cleanup function (guarded against double invocation from signal + finally)
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    console.log(`  [env] Cleaning up ${projectId}...`);

    await killProcess(nextProcess);

    stopSupabaseProject(tmpRoot, projectId);

    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      console.warn(`  [env] Warning: could not remove ${tmpRoot}`);
    }

    releasePortLock(basePort);
    unregisterEnv(projectId);
    console.log(`  [env] Cleanup complete for ${projectId}.`);
  };

  return { baseUrl, authStatePath: isolatedAuthPath, cleanup };
}
