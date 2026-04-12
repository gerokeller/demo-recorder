#!/usr/bin/env -S npx tsx

/**
 * Demo Recorder: reads a YAML scenario file and records a browser video demo.
 *
 * Usage:
 *   npx tsx demo-recorder-plugin/runner/record.ts <scenario.yaml>
 *
 * Environment:
 *   PLAYWRIGHT_BASE_URL  - Base URL (default: http://localhost:3000)
 *   DEMO_OUTPUT_DIR      - Output directory (default: demo-recorder-plugin/output)
 */

import fs from 'node:fs';
import path from 'node:path';
import { type Browser, chromium } from 'playwright';
import {
  type Beat,
  QUALITY_PRESETS,
  type QualityPreset,
  type Scenario,
  type Step,
  scenarioSchema,
} from './scenario-schema.ts';
import {
  executeStep,
  injectCustomCursor,
  type PacingContext,
  resetAnnotationState,
} from './step-executor.ts';

/**
 * Apply mobile overrides to a step. Returns null if the step is marked
 * `mobileSkip` and should be omitted on the mobile pass.
 */
function applyMobileOverrides(step: Step): Step | null {
  if ('mobileSkip' in step && step.mobileSkip) return null;

  // Clone only when there's an override to avoid surprising callers.
  const mobilePath =
    'mobilePath' in step ? (step as { mobilePath?: string }).mobilePath : undefined;
  const mobileSelector =
    'mobileSelector' in step ? (step as { mobileSelector?: string }).mobileSelector : undefined;

  if (!mobilePath && !mobileSelector) return step;

  const next = { ...step } as Record<string, unknown>;
  if (mobilePath && 'path' in step) next.path = mobilePath;
  if (mobileSelector && 'selector' in step) next.selector = mobileSelector;
  return next as Step;
}

interface SetupPassOptions {
  label: 'desktop' | 'mobile';
  browser: Browser;
  baseUrl: string;
  authStatePath: string;
  authProfile: string;
  isolated: boolean;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
  isMobile?: boolean;
  extraHTTPHeaders: Record<string, string>;
  tempVideoDir: string;
  showAnnotations: boolean;
}

/**
 * Live handle for a pass while it's recording. Each pass owns one Playwright
 * context + page, and the main step loop iterates both in parallel via
 * Promise.all. Because both pages start at the same moment and each scenario
 * step waits on Promise.all before the next step begins, the two recordings
 * share identical step boundaries and can be composited in Remotion without
 * any per-step time-remapping.
 */
interface PassRuntime {
  label: 'desktop' | 'mobile';
  context: import('playwright').BrowserContext;
  page: import('playwright').Page;
  showAnnotations: boolean;
}

async function setupPass(options: SetupPassOptions): Promise<PassRuntime> {
  const {
    label,
    browser,
    baseUrl,
    authStatePath,
    authProfile,
    isolated,
    viewport,
    deviceScaleFactor,
    userAgent,
    isMobile,
    extraHTTPHeaders,
    tempVideoDir,
    showAnnotations,
  } = options;

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    baseURL: baseUrl,
    viewport: { width: viewport.width, height: viewport.height },
    storageState: authStatePath,
    recordVideo: {
      dir: tempVideoDir,
      size: { width: viewport.width, height: viewport.height },
    },
  };
  if (deviceScaleFactor !== undefined) contextOptions.deviceScaleFactor = deviceScaleFactor;
  if (userAgent !== undefined) contextOptions.userAgent = userAgent;
  if (isMobile !== undefined) {
    contextOptions.isMobile = isMobile;
    contextOptions.hasTouch = isMobile;
  }
  if (Object.keys(extraHTTPHeaders).length > 0) {
    contextOptions.extraHTTPHeaders = extraHTTPHeaders;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    const { stubBackgroundRoutes } = await import('./helpers/network.ts');
    await stubBackgroundRoutes(page);
  } catch {
    console.warn(`Warning: could not stub background routes on ${label}.`);
  }

  try {
    await injectCustomCursor(page, isMobile ? 'mobile' : 'desktop');
  } catch {
    console.warn(`Warning: could not inject custom cursor on ${label}.`);
  }

  if (isolated && authStatePath) {
    const { AUTH_PROFILES } = await import('./auth-profiles.ts');
    const creds = AUTH_PROFILES[authProfile];
    if (creds) {
      console.log(`  [${label}] [auth] Verifying session for ${creds.email}...`);
      await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const currentPath = new URL(page.url()).pathname;
      if (currentPath.startsWith('/login')) {
        console.log(`  [${label}] [auth] No valid session, logging in via browser...`);
        await page.getByLabel('Email address').fill(creds.email);
        await page.getByLabel('Password').fill(creds.password);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
      }
      console.log(`  [${label}] [auth] Authenticated, at: ${new URL(page.url()).pathname}`);
      await page.goto('about:blank');
    }
  }

  return { label, context, page, showAnnotations };
}

async function teardownPass(
  pass: PassRuntime
): Promise<{ videoPath: string | undefined }> {
  const videoPath = await pass.page.video()?.path();
  await pass.page.close();
  await pass.context.close();
  return { videoPath };
}

// ---------------------------------------------------------------------------
// Lightweight YAML parser for simple scenario files.
// Handles the subset of YAML used by scenario files: scalars, mappings,
// sequences of mappings, and inline flow mappings like { width: 1280 }.
// ---------------------------------------------------------------------------

function parseYaml(text: string): unknown {
  // Use a line-based state-machine parser for the scenario YAML subset.
  const lines = text.split('\n');
  return parseLines(lines, 0, 0).value;
}

type ParseResult = { value: unknown; nextLine: number };

function parseLines(lines: string[], startLine: number, parentIndent: number): ParseResult {
  const result: Record<string, unknown> = {};
  let i = startLine;

  while (i < lines.length) {
    const raw = lines[i];

    // Skip empty lines and comments
    if (raw.trim() === '' || raw.trim().startsWith('#')) {
      i++;
      continue;
    }

    const lineIndent = raw.length - raw.trimStart().length;

    // If we've dedented past the parent, we're done with this block
    if (lineIndent < parentIndent && i > startLine) {
      break;
    }

    const trimmed = raw.trim();

    // Sequence item (- key: value or - action: ...)
    if (trimmed.startsWith('- ')) {
      // This is a list; collect all items at this indent level
      const arr: unknown[] = [];
      while (i < lines.length) {
        const r = lines[i];
        if (r.trim() === '' || r.trim().startsWith('#')) {
          i++;
          continue;
        }
        const ind = r.length - r.trimStart().length;
        if (ind < lineIndent && i > startLine) break;
        if (ind === lineIndent && r.trim().startsWith('- ')) {
          // Parse the item as an inline mapping
          const itemContent = r.trim().slice(2); // Remove "- "
          const item: Record<string, unknown> = {};
          // Parse first key-value on the "- " line
          const kvMatch = itemContent.match(/^(\w[\w-]*):\s*(.*)/);
          if (kvMatch) {
            item[kvMatch[1]] = parseScalar(kvMatch[2]);
          }
          i++;
          // Parse continuation lines at deeper indent
          const itemIndent = lineIndent + 2;
          while (i < lines.length) {
            const sub = lines[i];
            if (sub.trim() === '' || sub.trim().startsWith('#')) {
              i++;
              continue;
            }
            const subIndent = sub.length - sub.trimStart().length;
            if (subIndent < itemIndent) break;
            const subTrimmed = sub.trim();
            const subKv = subTrimmed.match(/^(\w[\w-]*):\s*(.*)/);
            if (subKv) {
              if (subKv[2] === '' || subKv[2] === null) {
                // Nested block follows; recurse to parse it.
                i++;
                let nextSub = i;
                while (
                  nextSub < lines.length &&
                  (lines[nextSub].trim() === '' || lines[nextSub].trim().startsWith('#'))
                ) {
                  nextSub++;
                }
                if (nextSub < lines.length) {
                  const nestedIndent = lines[nextSub].length - lines[nextSub].trimStart().length;
                  if (nestedIndent > subIndent) {
                    const nested = parseLines(lines, nextSub, nestedIndent);
                    item[subKv[1]] = nested.value;
                    i = nested.nextLine;
                  } else {
                    item[subKv[1]] = null;
                  }
                } else {
                  item[subKv[1]] = null;
                }
              } else {
                item[subKv[1]] = parseScalar(subKv[2]);
                i++;
              }
            } else {
              i++;
            }
          }
          arr.push(item);
        } else {
          break;
        }
      }
      // Find the key that should hold this array by looking at the
      // last key added to result that has no value yet or return array directly
      const keys = Object.keys(result);
      const lastKey = keys[keys.length - 1];
      if (lastKey && result[lastKey] === null) {
        result[lastKey] = arr;
      } else {
        return { value: arr, nextLine: i };
      }
      continue;
    }

    // Key: value mapping
    const kvMatch = trimmed.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2];

      if (rawValue === '' || rawValue === null) {
        // Nested block or array follows
        result[key] = null;
        i++;
        // Check if next non-empty line is indented further
        let nextNonEmpty = i;
        while (
          nextNonEmpty < lines.length &&
          (lines[nextNonEmpty].trim() === '' || lines[nextNonEmpty].trim().startsWith('#'))
        ) {
          nextNonEmpty++;
        }
        if (nextNonEmpty < lines.length) {
          const nextIndent = lines[nextNonEmpty].length - lines[nextNonEmpty].trimStart().length;
          if (nextIndent > lineIndent) {
            const nested = parseLines(lines, nextNonEmpty, nextIndent);
            result[key] = nested.value;
            i = nested.nextLine;
          }
        }
      } else {
        result[key] = parseScalar(rawValue);
        i++;
      }
      continue;
    }

    i++;
  }

  return { value: result, nextLine: i };
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();

  // Remove inline comments
  const commentFree = trimmed.replace(/\s+#.*$/, '');

  // Strip quotes
  if (
    (commentFree.startsWith('"') && commentFree.endsWith('"')) ||
    (commentFree.startsWith("'") && commentFree.endsWith("'"))
  ) {
    return commentFree.slice(1, -1);
  }

  // Flow mapping: { key: value, key: value }
  if (commentFree.startsWith('{') && commentFree.endsWith('}')) {
    const inner = commentFree.slice(1, -1);
    const obj: Record<string, unknown> = {};
    for (const part of inner.split(',')) {
      const kv = part.trim().match(/^(\w[\w-]*):\s*(.*)/);
      if (kv) {
        obj[kv[1]] = parseScalar(kv[2]);
      }
    }
    return obj;
  }

  // Flow array: [ value, value ]
  if (commentFree.startsWith('[') && commentFree.endsWith(']')) {
    const inner = commentFree.slice(1, -1);
    return inner.split(',').map((s) => parseScalar(s.trim()));
  }

  // Boolean
  if (commentFree === 'true') return true;
  if (commentFree === 'false') return false;

  // Null
  if (commentFree === 'null' || commentFree === '~' || commentFree === '') {
    return null;
  }

  // Number
  const num = Number(commentFree);
  if (!Number.isNaN(num) && commentFree !== '') return num;

  return commentFree;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Parse CLI args: separate flags and key-value pairs from positional arguments
  const args = process.argv.slice(2);
  const flags = new Set<string>();
  const flagValues = new Map<string, string>();
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--pr' || arg === '--preview-url' || arg === '--bypass-secret') {
      // These flags consume the next argument as their value
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        console.error(`Flag ${arg} requires a value.`);
        process.exit(1);
      }
      flagValues.set(arg, value);
      i++; // skip the value
    } else if (arg.startsWith('--')) {
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }

  const scenarioPath = positional[0] || process.env.DEMO_SCENARIO;

  if (!scenarioPath) {
    console.error('Usage: npx tsx demo-recorder-plugin/runner/record.ts <scenario.yaml>');
    process.exit(1);
  }

  const absolutePath = path.resolve(scenarioPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`Scenario file not found: ${absolutePath}`);
    process.exit(1);
  }

  // Parse YAML
  const raw = fs.readFileSync(absolutePath, 'utf-8');
  const parsed = parseYaml(raw);

  // Validate with Zod
  const result = scenarioSchema.safeParse(parsed);
  if (!result.success) {
    console.error('Invalid scenario file:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  const scenario: Scenario = result.data;
  let baseUrl =
    process.env.PLAYWRIGHT_BASE_URL ?? scenario.settings.baseUrl ?? 'http://localhost:3000';
  const outputDir = path.resolve(process.env.DEMO_OUTPUT_DIR ?? 'demo-recorder-plugin/output');

  // Resolve isolation mode: CLI flag > env var > scenario setting
  const isolated =
    flags.has('--isolated') || process.env.DEMO_ISOLATED === '1' || scenario.settings.isolated;

  // Resolve preview mode: CLI flag > env var > scenario setting
  const preview =
    flags.has('--preview') || process.env.DEMO_PREVIEW === '1' || scenario.settings.preview;
  const prNumber = flagValues.has('--pr') ? Number(flagValues.get('--pr')) : undefined;
  const previewUrlFlag = flagValues.get('--preview-url');
  const bypassSecretFlag = flagValues.get('--bypass-secret');

  let envCleanup: (() => Promise<void>) | undefined;
  let extraHTTPHeaders: Record<string, string> = {};

  if (isolated && preview) {
    console.error('Error: --isolated and --preview are mutually exclusive. Use one or the other.');
    process.exit(1);
  }

  if (preview && !prNumber && !previewUrlFlag) {
    console.error('Error: --preview requires either --pr <number> or --preview-url <url>.');
    process.exit(1);
  }

  if (isolated && process.env.PLAYWRIGHT_BASE_URL) {
    console.warn(
      'Warning: PLAYWRIGHT_BASE_URL is set alongside --isolated. The isolated environment URL will take precedence.'
    );
  }

  if (preview && process.env.PLAYWRIGHT_BASE_URL) {
    console.warn(
      'Warning: PLAYWRIGHT_BASE_URL is set alongside --preview. The preview URL will take precedence.'
    );
  }
  // Resolve viewport: DEMO_QUALITY env > settings.quality preset > settings.viewport > default.
  const qualityEnvRaw = process.env.DEMO_QUALITY?.toLowerCase();
  const qualityEnv =
    qualityEnvRaw && qualityEnvRaw in QUALITY_PRESETS
      ? (qualityEnvRaw as QualityPreset)
      : undefined;
  const qualityPreset = qualityEnv ?? scenario.settings.quality;
  const viewport = qualityPreset ? QUALITY_PRESETS[qualityPreset] : scenario.settings.viewport;
  // DEMO_ANNOTATIONS env var overrides the scenario setting (0/false to disable).
  const annotationsEnv = process.env.DEMO_ANNOTATIONS?.toLowerCase();
  const showAnnotations =
    annotationsEnv !== undefined
      ? annotationsEnv !== '0' && annotationsEnv !== 'false'
      : scenario.settings.showAnnotations;
  // DEMO_SEQUENCES env var overrides intro/outro (0/false to disable).
  const sequencesEnv = process.env.DEMO_SEQUENCES?.toLowerCase();
  const sequencesEnabled =
    sequencesEnv !== undefined
      ? sequencesEnv !== '0' && sequencesEnv !== 'false'
      : scenario.settings.sequences.enabled;

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Resolve auth storage state. Configurable via DEMO_AUTH_DIR for consumers
  // whose Playwright project stores auth state elsewhere.
  const authProfile = scenario.settings.auth;
  const authDir = process.env.DEMO_AUTH_DIR ?? 'web/e2e/.auth';
  let authStatePath = path.resolve(authDir, `${authProfile}.json`);

  // Start isolated environment if requested
  if (isolated) {
    console.log('Starting isolated environment...');
    const { createIsolatedEnv } = await import('./env-manager.ts');

    // Register signal handlers BEFORE awaiting startup so a SIGINT/SIGTERM
    // during createIsolatedEnv still triggers cleanup.
    const onSignal = () => {
      console.log('\nSignal received, cleaning up isolated environment...');
      if (envCleanup) {
        envCleanup().finally(() => process.exit(1));
      } else {
        process.exit(1);
      }
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    const env = await createIsolatedEnv({
      webDir: path.resolve(process.env.DEMO_WEB_DIR ?? 'web'),
      authProfile,
    });
    baseUrl = env.baseUrl;
    authStatePath = env.authStatePath;
    envCleanup = env.cleanup;

    console.log(`  Isolated base URL: ${baseUrl}\n`);
  }

  // Start preview environment if requested
  if (preview) {
    console.log('Starting preview environment...');
    const { createPreviewEnv } = await import('./preview-env.ts');

    const env = await createPreviewEnv({
      prNumber,
      previewUrl: previewUrlFlag,
      bypassSecret: bypassSecretFlag,
      authProfile,
    });

    baseUrl = env.baseUrl;
    extraHTTPHeaders = env.extraHTTPHeaders;
    envCleanup = env.cleanup;

    // Use preview auth state if generated, otherwise fall back to local auth state
    if (env.authStatePath) {
      authStatePath = env.authStatePath;
    }

    console.log(`  Preview base URL: ${baseUrl}\n`);
  }

  // Verify base URL is reachable before recording (skip check for isolated and
  // preview envs, which already verified reachability during setup).
  if (!isolated && !preview) {
    try {
      await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
    } catch {
      console.error(`Base URL not reachable: ${baseUrl}`);
      console.error(
        'Either start the dev server (npm run dev) or use isolated mode: DEMO_ISOLATED=1'
      );
      process.exit(1);
    }
  }

  const hasAuthState = fs.existsSync(authStatePath);

  if (!hasAuthState) {
    console.error(`Auth state not found for profile "${authProfile}" at ${authStatePath}`);
    console.error('Run "cd web && npx playwright test --project=setup" to generate auth state.');
    process.exit(1);
  }

  console.log(`Recording demo: ${scenario.title}`);
  console.log(`  Scenario: ${scenario.name}`);
  console.log(`  Auth: ${authProfile}`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log(`  Viewport: ${viewport.width}x${viewport.height}`);
  console.log(`  Annotations: ${showAnnotations ? 'on' : 'off'}`);
  console.log(`  Sequences: ${sequencesEnabled ? 'intro + outro' : 'off'}`);
  console.log(`  Mode: ${preview ? 'preview' : isolated ? 'isolated' : 'local'}`);
  console.log(`  Steps: ${scenario.steps.length}`);
  console.log('');

  // Resolve mobile mode: CLI flag > env var > scenario setting.
  // The scenario setting is the mobile block's `enabled` field.
  const mobileEnabled =
    flags.has('--mobile') || process.env.DEMO_MOBILE === '1' || scenario.settings.mobile.enabled;
  const mobileSettings = scenario.settings.mobile;

  console.log(`  Mobile: ${mobileEnabled ? `on (${mobileSettings.layout})` : 'off'}`);
  console.log('');

  let stepFailed = false;
  try {
    // Start Remotion pre-bundling in parallel with browser launch + recording.
    // The webpack bundle is the expensive step; running it concurrently with the
    // Playwright recording saves 5-15s of wall-clock time.
    let bundlePromise: Promise<import('./render-sequences.ts').RemotionBundle> | undefined;
    if (sequencesEnabled) {
      const { prebundleRemotionProject } = await import('./render-sequences.ts');
      bundlePromise = prebundleRemotionProject();
    }

    const browser = await chromium.launch({ headless: true });
    const tempVideoDir = path.join(outputDir, '.tmp-video');
    fs.mkdirSync(tempVideoDir, { recursive: true });

    // Captions and beat chips move to the Remotion canvas when a mobile
    // companion is recorded, so the two streams stay visually identical
    // and never disagree on in-frame overlays.
    const useCanvasCaptions = mobileEnabled;
    const passShowAnnotations = useCanvasCaptions ? false : showAnnotations;

    const desktopPass = await setupPass({
      label: 'desktop',
      browser,
      baseUrl,
      authStatePath,
      authProfile,
      isolated,
      viewport,
      extraHTTPHeaders,
      tempVideoDir,
      showAnnotations: passShowAnnotations,
    });

    let mobilePass: PassRuntime | undefined;
    if (mobileEnabled) {
      console.log('\nPreparing mobile companion pass...');
      mobilePass = await setupPass({
        label: 'mobile',
        browser,
        baseUrl,
        authStatePath,
        authProfile,
        isolated,
        viewport: mobileSettings.viewport,
        deviceScaleFactor: mobileSettings.deviceScaleFactor,
        userAgent: mobileSettings.userAgent,
        isMobile: true,
        extraHTTPHeaders,
        tempVideoDir,
        showAnnotations: passShowAnnotations,
      });
    }

    const passes: PassRuntime[] = [desktopPass, ...(mobilePass ? [mobilePass] : [])];

    resetAnnotationState();

    // Run the scenario step loop ONCE, executing each step in parallel on
    // every pass. Promise.all resolves when both (or all) passes finish the
    // step, so the two recordings advance in lockstep and share step
    // boundaries by construction — no canvas-side time remapping needed.
    const stepTimestamps: number[] = [];
    const recordingStart = Date.now();
    let hasNavigated = false;
    let previousAction: string | undefined;
    let previousBeat: Beat | undefined;

    try {
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const totalSteps = scenario.steps.length;
        const stepLabel =
          step.action === 'pause'
            ? `pause ${step.duration}ms`
            : `${step.action}${'selector' in step ? ` ${step.selector}` : ''}${'path' in step ? ` ${step.path}` : ''}`;
        console.log(`  [${i + 1}/${totalSteps}] ${stepLabel}`);

        const pacingContext: PacingContext = {
          stepIndex: i + 1,
          totalSteps,
          isFirstNavigation: step.action === 'navigate' && !hasNavigated,
          previousAction,
          previousBeat,
        };

        await Promise.all(
          passes.map(async (pass) => {
            const passStep = pass.label === 'mobile' ? applyMobileOverrides(step) : step;
            if (passStep === null) return; // mobileSkip: let the other pass carry the step
            try {
              await executeStep(pass.page, passStep, outputDir, pass.showAnnotations, {
                ...pacingContext,
                inputVariant: pass.label === 'mobile' ? 'mobile' : 'desktop',
              });
            } catch (error) {
              console.error(`[${pass.label}] Step ${i + 1} failed:`, error);
              throw error;
            }
          })
        );

        if (step.action === 'navigate') hasNavigated = true;
        previousAction = step.action;
        const stepBeatValue = 'beat' in step ? step.beat : undefined;
        if (stepBeatValue !== undefined) previousBeat = stepBeatValue;

        stepTimestamps.push(Date.now() - recordingStart);
      }
    } catch (error) {
      stepFailed = true;
      console.error('\nStep execution failed:', error);
      console.error('Saving partial video...');
    }

    const recordingDurationSec = (Date.now() - recordingStart) / 1000;

    const desktopTeardown = await teardownPass(desktopPass);
    const mobileTeardown = mobilePass ? await teardownPass(mobilePass) : undefined;
    await browser.close();

    const desktopVideoPath = desktopTeardown.videoPath;
    if (!desktopVideoPath || !fs.existsSync(desktopVideoPath)) {
      console.error('No desktop video file was produced.');
      process.exit(1);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const uniqueSuffix = Math.random().toString(36).slice(2, 8);
    const desktopRawName = `${scenario.name}-${timestamp}-${uniqueSuffix}.webm`;
    let desktopFinalPath = path.join(outputDir, desktopRawName);
    fs.renameSync(desktopVideoPath, desktopFinalPath);

    let mobileFinalPath: string | undefined;
    if (mobileTeardown?.videoPath && fs.existsSync(mobileTeardown.videoPath)) {
      const mobileRawName = `${scenario.name}-${timestamp}-${uniqueSuffix}-mobile.webm`;
      mobileFinalPath = path.join(outputDir, mobileRawName);
      fs.renameSync(mobileTeardown.videoPath, mobileFinalPath);
    }

    try {
      fs.rmdirSync(tempVideoDir);
    } catch {
      // Ignore if not empty
    }

    // Gather per-step narrative metadata for the Remotion caption bar.
    const stepAnnotations = scenario.steps.map((s) =>
      'annotation' in s ? (s.annotation ?? null) : null
    );
    const stepBeats = scenario.steps.map((s) =>
      'beat' in s ? (s.beat ?? null) : null
    );
    const stepEmphases = scenario.steps.map((s) =>
      'emphasis' in s ? (s.emphasis ?? null) : null
    );
    const stepActions = scenario.steps.map((s) => s.action);

    // Generate voice-over for each step annotation. Runs in parallel with
    // the Remotion bundle build; both complete before we start rendering.
    const voiceOverEnabled = process.env.DEMO_VOICEOVER !== '0' && !stepFailed;
    const voiceOverPromise = voiceOverEnabled
      ? (async () => {
          const { generateVoiceOver } = await import('./tts.ts');
          return generateVoiceOver({ texts: stepAnnotations, outputDir });
        })()
      : Promise.resolve({ provider: null, clips: [] });

    if (bundlePromise && !stepFailed) {
      try {
        console.log('\nRendering intro/outro sequences...');
        const [remotionBundle, voiceOverResult] = await Promise.all([
          bundlePromise,
          voiceOverPromise,
        ]);
        if (voiceOverResult.provider) {
          console.log(
            `  Voice-over: ${voiceOverResult.provider}, ${voiceOverResult.clips.length} clip(s)`
          );
        } else {
          console.log('  Voice-over: disabled (no provider available)');
        }
        const { renderWithSequences } = await import('./render-sequences.ts');
        const compositedPath = await renderWithSequences({
          rawVideoPath: desktopFinalPath,
          mobileVideoPath: mobileFinalPath,
          scenario,
          outputDir,
          viewport,
          mobileViewport: mobileFinalPath ? mobileSettings.viewport : undefined,
          mobileLayout: mobileFinalPath ? mobileSettings.layout : undefined,
          sequenceSettings: scenario.settings.sequences,
          recordingDurationSec,
          remotionBundle,
          stepTimestamps,
          stepAnnotations,
          stepBeats,
          stepEmphases,
          stepActions,
          useCanvasCaptions,
          voiceOverClips: voiceOverResult.clips,
        });
        fs.unlinkSync(desktopFinalPath);
        if (mobileFinalPath) fs.unlinkSync(mobileFinalPath);
        desktopFinalPath = compositedPath;
      } catch (renderError) {
        console.error('\nRemotion rendering failed; raw video preserved:', renderError);
      }
    }

    const stats = fs.statSync(desktopFinalPath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    console.log('');
    console.log(`${stepFailed ? 'Partial video' : 'Video'} saved: ${desktopFinalPath}`);
    console.log(`Size: ${sizeMb} MB`);
    if (mobileFinalPath && fs.existsSync(mobileFinalPath)) {
      console.log(`Mobile companion preserved: ${mobileFinalPath}`);
    }
  } finally {
    if (envCleanup) {
      console.log('\nCleaning up isolated environment...');
      await envCleanup();
    }
  }

  if (stepFailed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
