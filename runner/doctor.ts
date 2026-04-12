#!/usr/bin/env -S npx tsx

/**
 * Diagnostic check for the demo-recorder runtime. Each probe reports a
 * green/yellow/red status and an actionable remediation so a user can
 * bring the plugin up without trawling the README for error messages.
 *
 * Usage:
 *   npx tsx runner/doctor.ts
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectProvider } from './tts.ts';

type Level = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  level: Level;
  detail: string;
  remediation?: string;
}

function binExists(bin: string): boolean {
  const r = spawnSync('which', [bin], { stdio: 'ignore' });
  return r.status === 0;
}

function tryVersion(bin: string, args: string[] = ['--version']): string | null {
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return out.trim().split('\n')[0];
  } catch {
    return null;
  }
}

function probeNodeVersion(): Check {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 22) {
    return { name: 'Node.js', level: 'ok', detail: `v${process.versions.node}` };
  }
  return {
    name: 'Node.js',
    level: 'fail',
    detail: `v${process.versions.node} (v22+ required)`,
    remediation: 'Install Node 22 via `brew install node@22` or `fnm install 22`.',
  };
}

function probePlaywright(): Check {
  try {
    const version = tryVersion('npx', ['playwright', '--version']);
    if (version) return { name: 'Playwright CLI', level: 'ok', detail: version };
  } catch {
    // fallthrough
  }
  return {
    name: 'Playwright CLI',
    level: 'fail',
    detail: 'not available',
    remediation:
      'Install deps: `npm install`. Install browsers: `npx playwright install chromium`.',
  };
}

function probeChromium(): Check {
  // Playwright stores browsers under ~/Library/Caches/ms-playwright on macOS,
  // ~/.cache/ms-playwright on Linux, and %USERPROFILE%\AppData\Local\ms-playwright on Windows.
  const candidates = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      const entries = fs.readdirSync(dir).filter((e) => e.startsWith('chromium'));
      if (entries.length > 0) {
        return { name: 'Chromium browser', level: 'ok', detail: entries.sort().at(-1)! };
      }
    }
  }
  return {
    name: 'Chromium browser',
    level: 'fail',
    detail: 'not installed',
    remediation: 'Run `npx playwright install chromium`.',
  };
}

function probeAuthState(): Check {
  const authDir = process.env.DEMO_AUTH_DIR ?? './web/e2e/.auth';
  const resolved = path.resolve(authDir);
  if (!fs.existsSync(resolved)) {
    return {
      name: 'Playwright auth state',
      level: 'warn',
      detail: `${authDir} does not exist`,
      remediation:
        'Generate state via your Playwright setup project, or set DEMO_AUTH_DIR to an existing directory.',
    };
  }
  const files = fs.readdirSync(resolved).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  if (files.length === 0) {
    return {
      name: 'Playwright auth state',
      level: 'warn',
      detail: `${authDir} is empty`,
      remediation:
        'Run `cd web && npx playwright test --project=setup` (or your equivalent) to write <profile>.json.',
    };
  }
  return {
    name: 'Playwright auth state',
    level: 'ok',
    detail: `${files.length} profile(s) in ${authDir}`,
  };
}

function probeDocker(): Check {
  if (!binExists('docker')) {
    return {
      name: 'Docker (optional, isolated mode)',
      level: 'warn',
      detail: 'not installed',
      remediation:
        'Install Docker Desktop (https://www.docker.com) if you want to use `--isolated` mode.',
    };
  }
  const info = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
  if (info.status !== 0) {
    return {
      name: 'Docker daemon',
      level: 'warn',
      detail: 'not running',
      remediation: 'Start Docker Desktop before using `--isolated` mode.',
    };
  }
  return { name: 'Docker daemon', level: 'ok', detail: 'running' };
}

function probeFfmpeg(): Check {
  const version = tryVersion('ffmpeg', ['-version']);
  if (version) return { name: 'ffmpeg', level: 'ok', detail: version };
  return {
    name: 'ffmpeg',
    level: 'fail',
    detail: 'not installed',
    remediation:
      'Install via `brew install ffmpeg`. Required for converting TTS audio and probing durations.',
  };
}

function probeTts(): Check {
  const provider = detectProvider();
  if (!provider) {
    return {
      name: 'TTS provider',
      level: 'warn',
      detail: 'none available',
      remediation:
        'Install piper (`pipx install piper-tts`), authenticate gcloud, or set OPENAI_API_KEY. On macOS the `say` fallback is built in.',
    };
  }
  return { name: 'TTS provider', level: 'ok', detail: provider };
}

function probeGh(): Check {
  const version = tryVersion('gh', ['--version']);
  if (!version) {
    return {
      name: 'GitHub CLI (optional, story director)',
      level: 'warn',
      detail: 'not installed',
      remediation:
        'Install with `brew install gh` if you want the Story Director to fetch PR context.',
    };
  }
  return { name: 'GitHub CLI', level: 'ok', detail: version.split(' ').slice(0, 2).join(' ') };
}

const LEVEL_ICON: Record<Level, string> = {
  ok: '\u2714',
  warn: '\u26A0',
  fail: '\u2716',
};

const LEVEL_COLOR: Record<Level, string> = {
  ok: '\x1b[32m',
  warn: '\x1b[33m',
  fail: '\x1b[31m',
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

async function main(): Promise<void> {
  const checks: Check[] = [
    probeNodeVersion(),
    probePlaywright(),
    probeChromium(),
    probeFfmpeg(),
    probeAuthState(),
    probeDocker(),
    probeTts(),
    probeGh(),
  ];

  console.log('');
  console.log('demo-recorder doctor');
  console.log('────────────────────');
  for (const c of checks) {
    const icon = `${LEVEL_COLOR[c.level]}${LEVEL_ICON[c.level]}${RESET}`;
    console.log(`${icon}  ${c.name.padEnd(38)} ${DIM}${c.detail}${RESET}`);
    if (c.remediation) console.log(`   ${DIM}→ ${c.remediation}${RESET}`);
  }
  console.log('');

  const failures = checks.filter((c) => c.level === 'fail').length;
  const warnings = checks.filter((c) => c.level === 'warn').length;
  const summary =
    failures > 0
      ? `${failures} failing check(s); the recorder will not work until they're fixed.`
      : warnings > 0
        ? `${warnings} warning(s); the recorder will work but optional features may be disabled.`
        : 'All checks passed.';
  console.log(summary);
  console.log('');

  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('doctor failed:', err);
  process.exit(1);
});
