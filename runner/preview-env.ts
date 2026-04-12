/**
 * Preview environment manager for recording demos against Vercel preview deployments.
 *
 * Instead of spinning up a local Supabase + Next.js stack (like --isolated mode),
 * this connects to an existing Vercel preview deployment for a given PR. Each PR
 * already gets its own Vercel preview URL and Supabase branch database, providing
 * full data isolation without any local Docker overhead.
 *
 * Resolution strategies:
 * 1. Direct URL via --preview-url: use the provided URL as-is
 * 2. PR number via --pr: fetch the Vercel preview deployment URL from GitHub
 *    deployment statuses API
 *
 * Auth tokens are generated against the branch Supabase instance by extracting
 * connection details from the preview deployment's environment.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUTH_PROFILES, buildSupabaseStorageKey } from './auth-profiles.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreviewEnv {
  baseUrl: string;
  authStatePath: string;
  extraHTTPHeaders: Record<string, string>;
  cleanup: () => Promise<void>;
}

export interface CreatePreviewEnvOptions {
  /** PR number to resolve the preview URL from. */
  prNumber?: number;
  /** Direct preview deployment URL. */
  previewUrl?: string;
  /** Vercel automation bypass secret. */
  bypassSecret?: string;
  /** Auth profile name (default: 'ownerUser'). */
  authProfile?: string;
  /** Supabase URL for the branch database. Falls back to PREVIEW_SUPABASE_URL env var. */
  supabaseUrl?: string;
  /** Supabase anon key for the branch database. Falls back to PREVIEW_SUPABASE_ANON_KEY env var. */
  supabaseAnonKey?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = 'https://api.github.com';
const REPO_OWNER = '27-Street';
const REPO_NAME = 'client-requirements-tool';

// ---------------------------------------------------------------------------
// Bypass secret resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Vercel automation bypass secret.
 *
 * Precedence:
 * 1. Explicit value from --bypass-secret flag
 * 2. VERCEL_AUTOMATION_BYPASS_SECRET environment variable
 * 3. Interactive prompt (stdin) if running in a TTY
 *
 * Throws if no secret can be resolved in a non-interactive context.
 */
export async function resolveBypassSecret(explicit?: string): Promise<string> {
  // 1. Explicit flag value
  if (explicit !== undefined) {
    const trimmed = explicit.trim();
    if (!trimmed) {
      throw new Error('Bypass secret cannot be empty.');
    }
    return trimmed;
  }

  // 2. Environment variable
  const envValue = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (envValue) return envValue;

  // 3. Interactive prompt (only if TTY is available)
  if (process.stdin.isTTY) {
    return await promptForSecret('Enter Vercel automation bypass secret: ');
  }

  throw new Error(
    'Vercel bypass secret is required for preview mode. ' +
      'Provide it via --bypass-secret <value>, ' +
      'set VERCEL_AUTOMATION_BYPASS_SECRET in the environment, ' +
      'or run in an interactive terminal to be prompted.'
  );
}

/**
 * Prompt for a secret value without echoing it to the terminal.
 * Uses raw mode to suppress character echo and prints '*' for each keystroke.
 */
function promptForSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    let input = '';

    const onData = (ch: string) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r' || c === '\u0004') {
        // Enter or Ctrl-D: finish input
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        const trimmed = input.trim();
        if (!trimmed) {
          reject(new Error('Bypass secret cannot be empty.'));
        } else {
          resolve(trimmed);
        }
      } else if (c === '\u0003') {
        // Ctrl-C: abort
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        reject(new Error('Aborted by user.'));
      } else if (c === '\u007F' || c === '\b') {
        // Backspace: remove last character
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stderr.write('\b \b');
        }
      } else {
        // Regular character: mask with asterisk
        input += c;
        process.stderr.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------------------
// Preview URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Vercel preview deployment URL for a given PR number.
 *
 * Queries the GitHub deployments API for the PR's head SHA, then finds
 * the most recent successful Vercel deployment.
 */
async function resolvePreviewUrlFromPR(prNumber: number): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'demo-recorder-plugin',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // 1. Get the PR to find the head SHA and ref
  console.log(`  [preview] Fetching PR #${prNumber} details...`);
  const prRes = await fetch(
    `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`,
    {
      headers,
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!prRes.ok) {
    const body = await prRes.text();
    throw new Error(
      `Failed to fetch PR #${prNumber} (${prRes.status}): ${body}. ` +
        (token ? '' : 'Set GITHUB_TOKEN for private repo access.')
    );
  }

  const pr = (await prRes.json()) as {
    head: { sha: string; ref: string };
    state: string;
  };

  const headSha = pr.head.sha;
  const headRef = pr.head.ref;
  console.log(`  [preview] PR head: ${headRef} (${headSha.slice(0, 7)})`);

  // 2. Fetch deployment statuses for the head SHA
  console.log('  [preview] Looking for Vercel deployment...');
  const deploymentsRes = await fetch(
    `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/deployments?sha=${headSha}&per_page=10`,
    { headers, signal: AbortSignal.timeout(15_000) }
  );

  if (!deploymentsRes.ok) {
    throw new Error(`Failed to fetch deployments for SHA ${headSha}: ${deploymentsRes.status}`);
  }

  const deployments = (await deploymentsRes.json()) as Array<{
    id: number;
    environment: string;
    created_at: string;
  }>;

  // Filter all preview deployments (case-insensitive match).
  const previewDeployments = deployments.filter((d) => d.environment.toLowerCase() === 'preview');

  if (previewDeployments.length === 0) {
    throw new Error(
      `No Vercel preview deployment found for PR #${prNumber} (SHA: ${headSha.slice(0, 7)}). ` +
        'Ensure the PR has a Vercel deployment and try again.'
    );
  }

  // 3. Iterate deployments (newest first) to find the first successful one.
  //    If the latest redeploy is queued/in_progress/failure, an older
  //    successful deployment for the same PR is still usable.
  let lastStates = '';

  for (const deployment of previewDeployments) {
    const statusesRes = await fetch(
      `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/deployments/${deployment.id}/statuses?per_page=5`,
      { headers, signal: AbortSignal.timeout(15_000) }
    );

    if (!statusesRes.ok) {
      throw new Error(
        `Failed to fetch deployment statuses for deployment ${deployment.id}: ${statusesRes.status}`
      );
    }

    const statuses = (await statusesRes.json()) as Array<{
      state: string;
      target_url?: string;
      environment_url?: string;
    }>;

    lastStates = statuses.map((s) => s.state).join(', ');

    const successStatus = statuses.find((s) => s.state === 'success');
    const previewUrl = successStatus?.environment_url ?? successStatus?.target_url;
    if (previewUrl) {
      return previewUrl;
    }
  }

  throw new Error(
    `No successful deployment found for PR #${prNumber}. ` +
      `Deployment statuses: [${lastStates}]. ` +
      'Wait for the deployment to complete and retry.'
  );
}

// ---------------------------------------------------------------------------
// Auth state generation for preview environments
// ---------------------------------------------------------------------------

/**
 * Generate Playwright-compatible auth storage state by signing in via the
 * Supabase GoTrue API. Reuses the same approach as env-manager.ts but
 * pointed at the branch Supabase instance.
 */
async function generatePreviewAuthState(
  supabaseUrl: string,
  supabaseAnonKey: string,
  authProfile: string,
  outputPath: string,
  baseUrl: string
): Promise<void> {
  const creds = AUTH_PROFILES[authProfile];
  if (!creds) {
    throw new Error(
      `Unknown auth profile "${authProfile}". ` +
        `Available: ${Object.keys(AUTH_PROFILES).join(', ')}`
    );
  }

  console.log(`  [preview-auth] Signing in as ${creds.email} via Supabase API...`);

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Auth sign-in failed (${res.status}): ${body}. ` +
        'Verify the Supabase branch database is running and seeded.'
    );
  }

  const session = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    token_type: string;
    user: { id: string };
  };

  const storageKey = buildSupabaseStorageKey(supabaseUrl);
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

  // Parse the base URL to extract cookie domain
  const baseUrlParsed = new URL(baseUrl);

  const storageState = {
    cookies: [
      {
        name: storageKey,
        value: cookieValue,
        domain: baseUrlParsed.hostname,
        path: '/',
        expires: (session.expires_at ?? Math.floor(Date.now() / 1000)) + 86400,
        httpOnly: false,
        secure: baseUrlParsed.protocol === 'https:',
        sameSite: 'Lax' as const,
      },
    ],
    origins: [
      {
        origin: baseUrl,
        localStorage: [{ name: storageKey, value: storageValue }],
      },
    ],
  };

  fs.writeFileSync(outputPath, JSON.stringify(storageState, null, 2));
  console.log(`  [preview-auth] Auth state written for ${authProfile}.`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a preview environment for recording demos against a Vercel preview
 * deployment. Near-instant startup with no Docker overhead.
 */
export async function createPreviewEnv(options: CreatePreviewEnvOptions): Promise<PreviewEnv> {
  const { prNumber, previewUrl: rawPreviewUrl, authProfile = 'ownerUser' } = options;
  const explicitUrl = rawPreviewUrl?.trim();

  if (explicitUrl && prNumber !== undefined) {
    throw new Error('Preview mode requires either --pr <number> or --preview-url <url>, not both.');
  }

  // 1. Resolve the preview URL
  let baseUrl: string;
  if (explicitUrl) {
    baseUrl = explicitUrl.replace(/\/$/, '');
    console.log(`  [preview] Using provided URL: ${baseUrl}`);
  } else if (prNumber !== undefined) {
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error(`Invalid PR number: expected a positive integer, got ${prNumber}.`);
    }
    baseUrl = await resolvePreviewUrlFromPR(prNumber);
    console.log(`  [preview] Resolved preview URL: ${baseUrl}`);
  } else {
    throw new Error('Preview mode requires either --pr <number> or --preview-url <url>.');
  }

  // 2. Resolve the bypass secret
  const bypassSecret = await resolveBypassSecret(options.bypassSecret);

  // 3. Verify the preview deployment is reachable
  console.log('  [preview] Verifying deployment is reachable...');
  try {
    const checkRes = await fetch(baseUrl, {
      headers: { 'x-vercel-protection-bypass': bypassSecret },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });
    if (!checkRes.ok) {
      throw new Error(`Preview deployment returned ${checkRes.status}`);
    }
    console.log(`  [preview] Deployment reachable (${checkRes.status}).`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Preview deployment not reachable at ${baseUrl}: ${msg}. ` +
        'Verify the URL and bypass secret are correct.'
    );
  }

  // 4. Resolve Supabase branch connection details
  const supabaseUrl = options.supabaseUrl ?? process.env.PREVIEW_SUPABASE_URL;
  const supabaseAnonKey = options.supabaseAnonKey ?? process.env.PREVIEW_SUPABASE_ANON_KEY;

  // 5. Generate auth state if Supabase details are available
  if (!supabaseUrl || !supabaseAnonKey) {
    console.log(
      '  [preview] No Supabase branch credentials provided. ' + 'Falling back to local auth state.'
    );
    console.log(
      '  [preview] Set PREVIEW_SUPABASE_URL and PREVIEW_SUPABASE_ANON_KEY ' +
        'for branch-specific auth.'
    );
    return {
      baseUrl,
      authStatePath: '',
      extraHTTPHeaders: { 'x-vercel-protection-bypass': bypassSecret },
      cleanup: () => Promise.resolve(),
    };
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-preview-'));
  const cleanup = (): Promise<void> => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
    return Promise.resolve();
  };

  try {
    const tmpAuthDir = path.join(tmpBase, 'auth');
    fs.mkdirSync(tmpAuthDir, { recursive: true });
    const authStatePath = path.join(tmpAuthDir, `${authProfile}.json`);

    console.log(`  [preview] Supabase URL: ${supabaseUrl}`);
    await generatePreviewAuthState(
      supabaseUrl,
      supabaseAnonKey,
      authProfile,
      authStatePath,
      baseUrl
    );

    return {
      baseUrl,
      authStatePath,
      extraHTTPHeaders: { 'x-vercel-protection-bypass': bypassSecret },
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
