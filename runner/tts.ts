/**
 * Text-to-speech pipeline for demo voice-over.
 *
 * Provider priority (first available wins):
 *  1. Piper (local, neural, offline, no account)        - needs `piper` on PATH + voice model
 *  2. Google Cloud TTS (OAuth via gcloud, generous free) - needs `gcloud auth application-default`
 *  3. OpenAI TTS (API key, high quality)                - needs OPENAI_API_KEY
 *  4. macOS `say` (local, robotic but always available) - macOS only
 *
 * The pipeline writes one MP3 per step annotation into `<outputDir>/.tts/`
 * and returns the list of generated clips. The caller passes them into the
 * Remotion composition so each clip plays during its step's canvas window.
 */

import { execFile, execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TtsProviderName = 'piper' | 'google' | 'openai' | 'say';

export interface TtsClip {
  /** Scenario step index this clip belongs to (0-based). */
  stepIndex: number;
  /** Path to the generated MP3, relative to outputDir. */
  path: string;
  /** Duration of the generated audio, in seconds. */
  durationSec: number;
}

export interface GenerateOptions {
  /** Texts to synthesize, aligned 1:1 with scenario steps (null = skip). */
  texts: (string | null)[];
  /** Destination directory for audio files. */
  outputDir: string;
  /** Optional explicit provider override (otherwise auto-detect). */
  provider?: TtsProviderName;
  /** Optional voice parameter passed to the provider (model-specific). */
  voice?: string;
}

export interface GenerateResult {
  provider: TtsProviderName | null;
  clips: TtsClip[];
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

function binExists(bin: string): boolean {
  const result = spawnSync('which', [bin], { stdio: 'ignore' });
  return result.status === 0;
}

function hasGcloudAuth(): boolean {
  if (!binExists('gcloud')) return false;
  const result = spawnSync('gcloud', ['auth', 'application-default', 'print-access-token'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  });
  return result.status === 0 && result.stdout.toString().trim().length > 0;
}

function piperModelPath(): string | undefined {
  // Allow an explicit model path via env var; otherwise look in the default
  // cache directory.
  if (process.env.PIPER_MODEL && fs.existsSync(process.env.PIPER_MODEL)) {
    return process.env.PIPER_MODEL;
  }
  const cacheDir = path.join(os.homedir(), '.cache', 'piper', 'voices');
  if (!fs.existsSync(cacheDir)) return undefined;
  const onnx = fs
    .readdirSync(cacheDir)
    .find((f) => f.endsWith('.onnx') && !f.endsWith('.onnx.json'));
  return onnx ? path.join(cacheDir, onnx) : undefined;
}

/** Detect which provider to use. Returns `null` when no provider is available. */
export function detectProvider(): TtsProviderName | null {
  if (binExists('piper') && piperModelPath()) return 'piper';
  if (hasGcloudAuth()) return 'google';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.platform === 'darwin' && binExists('say')) return 'say';
  return null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function hashText(text: string, salt = ''): string {
  return crypto.createHash('sha256').update(salt + '|' + text).digest('hex').slice(0, 12);
}

/** Probe an audio file's duration in seconds using ffprobe. */
function probeAudioDuration(filePath: string): number {
  try {
    const out = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      { encoding: 'utf-8', timeout: 10_000 }
    );
    const sec = Number.parseFloat(out.trim());
    return Number.isFinite(sec) ? sec : 0;
  } catch {
    return 0;
  }
}

async function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '192k',
    outputPath,
  ]);
}

// ---------------------------------------------------------------------------
// Piper (local, neural, offline)
// ---------------------------------------------------------------------------

async function generatePiper(text: string, outPath: string): Promise<void> {
  const model = piperModelPath();
  if (!model) throw new Error('Piper voice model not found');

  const tmpWav = `${outPath}.wav`;
  await new Promise<void>((resolve, reject) => {
    const proc = execFile(
      'piper',
      ['--model', model, '--output_file', tmpWav],
      { timeout: 60_000 },
      (err) => (err ? reject(err) : resolve())
    );
    proc.stdin?.write(text);
    proc.stdin?.end();
  });

  await convertToMp3(tmpWav, outPath);
  fs.unlinkSync(tmpWav);
}

// ---------------------------------------------------------------------------
// Google Cloud TTS (OAuth via gcloud ADC)
// ---------------------------------------------------------------------------

async function generateGoogle(text: string, outPath: string, voice: string): Promise<void> {
  const token = execFileSync(
    'gcloud',
    ['auth', 'application-default', 'print-access-token'],
    { encoding: 'utf-8', timeout: 10_000 }
  ).trim();

  // Default to a Neural2 voice for good quality + low cost; the caller can
  // override via the voice option.
  const voiceName = voice || 'en-US-Neural2-F';
  const languageCode = voiceName.split('-').slice(0, 2).join('-');

  const resp = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Google TTS request failed: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { audioContent?: string };
  if (!data.audioContent) throw new Error('Google TTS response missing audioContent');
  fs.writeFileSync(outPath, Buffer.from(data.audioContent, 'base64'));
}

// ---------------------------------------------------------------------------
// OpenAI TTS (API key)
// ---------------------------------------------------------------------------

async function generateOpenAi(text: string, outPath: string, voice: string): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const voiceName = voice || 'alloy';
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'tts-1', voice: voiceName, input: text, format: 'mp3' }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI TTS request failed: ${resp.status} ${await resp.text()}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

// ---------------------------------------------------------------------------
// macOS `say` fallback
// ---------------------------------------------------------------------------

async function generateSay(text: string, outPath: string, voice: string): Promise<void> {
  const voiceName = voice || 'Samantha';
  const tmpAiff = `${outPath}.aiff`;
  await execFileAsync('say', ['-v', voiceName, '-o', tmpAiff, text], { timeout: 60_000 });
  await convertToMp3(tmpAiff, outPath);
  fs.unlinkSync(tmpAiff);
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

/**
 * Generate per-step audio clips for the given step annotations. Returns the
 * resolved provider plus a list of (stepIndex, path, duration) tuples.
 */
export async function generateVoiceOver(options: GenerateOptions): Promise<GenerateResult> {
  const { texts, outputDir, voice = '' } = options;
  const provider = options.provider ?? detectProvider();
  if (!provider) {
    console.warn('[tts] No provider available; skipping voice-over.');
    return { provider: null, clips: [] };
  }

  const ttsDir = path.join(outputDir, '.tts');
  fs.mkdirSync(ttsDir, { recursive: true });

  console.log(`[tts] Using provider: ${provider}`);

  const clips: TtsClip[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text || text.trim().length === 0) continue;

    // Cache by content hash so re-runs with identical annotations are cheap.
    const filename = `step-${String(i).padStart(2, '0')}-${hashText(text, provider)}.mp3`;
    const outPath = path.join(ttsDir, filename);

    if (!fs.existsSync(outPath)) {
      try {
        switch (provider) {
          case 'piper':
            await generatePiper(text, outPath);
            break;
          case 'google':
            await generateGoogle(text, outPath, voice);
            break;
          case 'openai':
            await generateOpenAi(text, outPath, voice);
            break;
          case 'say':
            await generateSay(text, outPath, voice);
            break;
        }
      } catch (err) {
        console.warn(`[tts] Failed on step ${i + 1}: ${(err as Error).message}`);
        continue;
      }
    }

    const durationSec = probeAudioDuration(outPath);
    clips.push({ stepIndex: i, path: outPath, durationSec });
    console.log(`[tts]   step ${i + 1}: ${filename} (${durationSec.toFixed(2)}s)`);
  }

  return { provider, clips };
}
