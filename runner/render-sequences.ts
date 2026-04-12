/**
 * Remotion-based render pipeline: wraps a raw Playwright recording with
 * an animated intro and a step-summary outro, producing a single composited video.
 *
 * Flow: prebundle() (parallel with recording) -> renderWithSequences()
 */

import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { CompositionInput, StepSummary } from './remotion/composition-schema.ts';
import { FPS } from './remotion/styles.ts';
import type { MobileSettings, Scenario, SequenceSettings } from './scenario-schema.ts';

// ---------------------------------------------------------------------------
// Adaptive duration helpers
// ---------------------------------------------------------------------------

const WORDS_PER_SECOND = 3; // comfortable reading speed for video titles

/** Count words in a string. */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Compute a duration scaling factor based on the total recording length.
 * Short demos get shorter intros/outros; long demos get more breathing room.
 */
function durationScale(recordingDurationSec: number): number {
  if (recordingDurationSec < 30) return 0.8;
  if (recordingDurationSec > 90) return 1.2;
  return 1.0;
}

/**
 * Compute intro duration (seconds) from title + description length,
 * scaled by recording duration for proportional pacing.
 *
 * Budget:
 *  - 1.5s for the entrance animation (accent line + title slide-up)
 *  - Reading time for title at 3 words/sec
 *  - Reading time for description at 3 words/sec
 *  - 1s hold after everything is visible
 *  - 0.7s fade-out transition (crossfade overlap)
 *
 * Floor: 4s (short titles still feel unhurried)
 * Cap: 12s (avoids dragging for very long descriptions)
 */
function computeIntroDurationSec(
  title: string,
  description: string,
  recordingDurationSec: number
): number {
  const entranceMs = 1500;
  const titleReadMs = (wordCount(title) / WORDS_PER_SECOND) * 1000;
  const descReadMs = (wordCount(description) / WORDS_PER_SECOND) * 1000;
  const holdMs = 1000;
  const fadeMs = 700;
  const totalMs =
    (entranceMs + titleReadMs + descReadMs + holdMs + fadeMs) * durationScale(recordingDurationSec);
  return Math.min(12, Math.max(4, Math.ceil(totalMs / 1000)));
}

/**
 * Compute outro duration (seconds) from step annotations and optional highlights,
 * scaled by recording duration for proportional pacing.
 *
 * Budget:
 *  - 1s for the header entrance
 *  - 0.1s stagger per visible step (faster than before for snappier feel)
 *  - Reading time for each annotation at 3 words/sec
 *  - Reading time for highlights (if present)
 *  - 1.5s hold after all steps are visible
 *  - 0.7s fade-out transition
 *
 * Floor: 5s (even a single step needs breathing room)
 * Cap: 15s (keeps the outro from overstaying)
 */
function computeOutroDurationSec(
  steps: StepSummary[],
  recordingDurationSec: number,
  highlights?: string[]
): number {
  const annotated = steps.filter((s) => s.annotation);

  const headerMs = 1000;
  const staggerMs = annotated.length * 100;
  const readingMs = annotated.reduce(
    (sum, s) => sum + (wordCount(s.annotation ?? '') / WORDS_PER_SECOND) * 1000,
    0
  );
  const highlightsMs = highlights
    ? highlights.reduce((sum, h) => sum + (wordCount(h) / WORDS_PER_SECOND) * 1000, 0) + 800
    : 0;
  const holdMs = 1500;
  const fadeMs = 700;
  const totalMs =
    (headerMs + staggerMs + readingMs + highlightsMs + holdMs + fadeMs) *
    durationScale(recordingDurationSec);
  return Math.min(15, Math.max(5, Math.ceil(totalMs / 1000)));
}

// ---------------------------------------------------------------------------
// Pre-bundling (runs in parallel with browser recording)
// ---------------------------------------------------------------------------

/** Result of the pre-bundle step; passed to renderWithSequences(). */
export interface RemotionBundle {
  /** Path to the webpack bundle output directory. */
  bundleLocation: string;
}

/**
 * Start the Remotion webpack bundle ahead of time.
 *
 * This is the expensive step (5-15s cold, faster with cache). Call it as
 * early as possible (before recording starts) and `await` the result only
 * when you need to render.
 */
export async function prebundleRemotionProject(): Promise<RemotionBundle> {
  const entryPoint = path.resolve(
    import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
    'remotion',
    'register.tsx'
  );

  console.log('  Pre-bundling Remotion project...');
  const bundleLocation = await bundle({ entryPoint });
  console.log('  Remotion bundle ready.');
  return { bundleLocation };
}

// ---------------------------------------------------------------------------
// Rendering (runs after recording completes)
// ---------------------------------------------------------------------------

export interface RenderSequencesOptions {
  /** Absolute path to the raw desktop Playwright .webm recording. */
  rawVideoPath: string;
  /** Optional absolute path to a parallel mobile .webm recording. */
  mobileVideoPath?: string;
  /** Validated scenario (provides title, description, steps). */
  scenario: Scenario;
  /** Directory for final output. */
  outputDir: string;
  /** Desktop viewport dimensions, matches the raw recording size. */
  viewport: { width: number; height: number };
  /** Mobile viewport, provided when a mobile companion recording exists. */
  mobileViewport?: { width: number; height: number };
  /** Mobile composition layout (only applied when mobileVideoPath is set). */
  mobileLayout?: MobileSettings['layout'];
  /** Sequence settings (durations, brand color). */
  sequenceSettings: SequenceSettings;
  /** Duration used for intro/outro scaling (max of both passes). */
  recordingDurationSec: number;
  /** Pre-built Remotion bundle from prebundleRemotionProject(). */
  remotionBundle: RemotionBundle;
  /** Shared end-of-step timestamps (ms) — parallel execution means both passes agree. */
  stepTimestamps?: number[];
  /** Per-step annotations for the canvas caption bar (null = no caption). */
  stepAnnotations?: (string | null)[];
  /** Per-step narrative beats for the canvas beat chip overlay. */
  stepBeats?: ('setup' | 'action' | 'payoff' | 'close' | null)[];
  /** Per-step caption emphasis (strong renders as a title card). */
  stepEmphases?: ('normal' | 'strong' | null)[];
  /** Per-step action names (for icon rendering in the caption bar). */
  stepActions?: string[];
  /** Render captions on the canvas below the videos instead of in-DOM. */
  useCanvasCaptions?: boolean;
  /**
   * Voice-over clips generated by runner/tts.ts. Each clip is an absolute
   * path to an MP3 and a step index; render-sequences copies each file into
   * the Remotion bundle's public dir and emits one `<Audio>` per clip.
   */
  voiceOverClips?: Array<{ stepIndex: number; path: string; durationSec: number }>;
}

/**
 * Render the final composited video with intro + recording + outro.
 * Returns the absolute path to the output file.
 */
export async function renderWithSequences(options: RenderSequencesOptions): Promise<string> {
  const {
    rawVideoPath,
    mobileVideoPath,
    scenario,
    outputDir,
    viewport,
    mobileViewport,
    mobileLayout,
    sequenceSettings,
    recordingDurationSec,
    remotionBundle,
    stepTimestamps,
    stepAnnotations,
    stepBeats,
    stepEmphases,
    stepActions,
    useCanvasCaptions,
    voiceOverClips,
  } = options;

  // Build step summaries for the outro
  const steps: StepSummary[] = scenario.steps.map((step, i) => ({
    index: i + 1,
    action: step.action,
    annotation: 'annotation' in step ? (step.annotation as string | undefined) : undefined,
  }));

  // Resolve durations: explicit override OR adaptive computation
  const fps = FPS;
  const introDurationSec =
    sequenceSettings.introDurationSec ??
    computeIntroDurationSec(scenario.title, scenario.description, recordingDurationSec);
  const outroDurationSec =
    sequenceSettings.outroDurationSec ??
    computeOutroDurationSec(steps, recordingDurationSec, sequenceSettings.highlights);

  const introDurationFrames = Math.ceil(introDurationSec * fps);
  const outroDurationFrames = Math.ceil(outroDurationSec * fps);

  const hasMobile = Boolean(mobileVideoPath && fs.existsSync(mobileVideoPath));

  // Parallel execution means both passes share identical timing. Canvas
  // video duration is simply the recording duration.
  const videoDurationFrames = Math.ceil(recordingDurationSec * fps);

  console.log(
    `  Intro: ${introDurationSec}s, Outro: ${outroDurationSec}s, Canvas video: ${(videoDurationFrames / fps).toFixed(2)}s`
  );

  // When we render side-by-side, the output canvas widens just enough to
  // fit a phone frame beside the desktop recording at its native size.
  // 1.22x gives the phone column ~20% without shrinking the desktop pane.
  const effectiveLayout = hasMobile ? (mobileLayout ?? 'side-by-side') : undefined;
  const outputWidth =
    effectiveLayout === 'side-by-side'
      ? Math.ceil((viewport.width * 1.22) / 2) * 2
      : viewport.width;

  // Canvas caption bar lives below the video area. Reserve 180px of height
  // for the pill + progress + beat indicator when canvas captions are on.
  const captionBarHeight = useCanvasCaptions ? 180 : 0;
  const outputHeight = viewport.height + captionBarHeight;

  // Copy the recorded video and audio clips into the bundle's public dir
  // BEFORE building inputProps, so the composition's staticFile() references
  // resolve at render time. Voice-over paths are rewritten to their
  // public-relative names.
  const publicDir = path.join(remotionBundle.bundleLocation, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.copyFileSync(rawVideoPath, path.join(publicDir, 'recorded.webm'));
  if (hasMobile && mobileVideoPath) {
    fs.copyFileSync(mobileVideoPath, path.join(publicDir, 'recorded-mobile.webm'));
  }

  const compositionVoiceOver = voiceOverClips?.map((clip) => {
    const publicName = `voice-${String(clip.stepIndex).padStart(2, '0')}.mp3`;
    fs.copyFileSync(clip.path, path.join(publicDir, publicName));
    return { src: publicName, stepIndex: clip.stepIndex, durationSec: clip.durationSec };
  });

  const inputProps: CompositionInput = {
    title: scenario.title,
    description: scenario.description,
    videoSrc: 'recorded.webm',
    videoDurationFrames,
    fps,
    width: outputWidth,
    height: outputHeight,
    introDurationFrames,
    outroDurationFrames,
    brandColor: sequenceSettings.brandColor,
    steps,
    category: sequenceSettings.category,
    sprintLabel: sequenceSettings.sprintLabel,
    orgName: sequenceSettings.orgName,
    highlights: sequenceSettings.highlights,
    recordedDate: new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    recordingDurationSec,
    desktopVideoWidth: viewport.width,
    desktopVideoHeight: viewport.height,
    mobileVideoSrc: hasMobile ? 'recorded-mobile.webm' : undefined,
    mobileWidth: hasMobile ? mobileViewport?.width : undefined,
    mobileHeight: hasMobile ? mobileViewport?.height : undefined,
    mobileLayout: effectiveLayout,
    stepTimestamps,
    stepAnnotations,
    stepBeats,
    stepEmphases,
    stepActions,
    useCanvasCaptions,
    captionBarHeight: captionBarHeight || undefined,
    voiceOverClips: compositionVoiceOver,
  };

  // 1. Select the composition (resolves calculateMetadata)
  console.log('  Selecting composition...');
  const composition = await selectComposition({
    serveUrl: remotionBundle.bundleLocation,
    id: 'demo-video',
    inputProps,
  });

  // 2. Render the final video (H.264, CRF 16 for high visual fidelity)
  const rawBaseName = path.basename(rawVideoPath, '.webm');
  const finalName = `${rawBaseName}-final.mp4`;
  const finalPath = path.join(outputDir, finalName);

  console.log('  Rendering composited video...');
  await renderMedia({
    composition,
    serveUrl: remotionBundle.bundleLocation,
    codec: 'h264',
    crf: 16,
    pixelFormat: 'yuv420p',
    outputLocation: finalPath,
    inputProps,
  });

  return finalPath;
}
