import { z } from 'zod';

export const stepSummarySchema = z.object({
  index: z.number().int().positive(),
  action: z.string(),
  annotation: z.string().optional(),
});

export const compositionInputSchema = z.object({
  title: z.string(),
  description: z.string(),
  videoSrc: z.string(),
  videoDurationFrames: z.number().int().positive(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  introDurationFrames: z.number().int().nonnegative(),
  outroDurationFrames: z.number().int().nonnegative(),
  brandColor: z.string(),
  steps: z.array(stepSummarySchema),
  // Metadata fields for intro/outro
  category: z.string().optional(),
  sprintLabel: z.string().optional(),
  orgName: z.string().optional(),
  highlights: z.array(z.string()).optional(),
  recordedDate: z.string().optional(),
  recordingDurationSec: z.number().optional(),
  // Desktop recording viewport (distinct from canvas width/height when the
  // canvas is widened for side-by-side). Drives aspect-ratio fitting.
  desktopVideoWidth: z.number().int().positive().optional(),
  desktopVideoHeight: z.number().int().positive().optional(),
  // Mobile companion stream
  mobileVideoSrc: z.string().optional(),
  mobileWidth: z.number().int().positive().optional(),
  mobileHeight: z.number().int().positive().optional(),
  mobileLayout: z.enum(['side-by-side', 'pip', 'sequential']).optional(),
  // Per-step end timestamps (ms). Since both desktop and mobile passes run in
  // lockstep via Promise.all, a single shared timestamp array is enough to
  // drive the Remotion caption bar and beat chip overlay.
  stepTimestamps: z.array(z.number()).optional(),
  stepAnnotations: z.array(z.string().nullable()).optional(),
  stepBeats: z.array(z.enum(['setup', 'action', 'payoff', 'close']).nullable()).optional(),
  stepEmphases: z.array(z.enum(['normal', 'strong']).nullable()).optional(),
  stepActions: z.array(z.string()).optional(),
  // When true, the composition renders captions and beat chips as canvas
  // overlays (below the videos) instead of relying on DOM-injected overlays
  // baked into each recording.
  useCanvasCaptions: z.boolean().optional(),
  captionBarHeight: z.number().int().positive().optional(),
  /**
   * Voice-over clips. Each entry anchors a per-step audio file to the start
   * of that scenario step on the canvas timeline.
   */
  voiceOverClips: z
    .array(
      z.object({
        /** Path relative to the bundle's public/ (set up by render-sequences). */
        src: z.string(),
        /** Scenario step index this clip belongs to (0-based). */
        stepIndex: z.number().int().nonnegative(),
        /** Duration of the clip in seconds (used to size the Sequence). */
        durationSec: z.number().positive(),
      })
    )
    .optional(),
});

export type CompositionInput = z.infer<typeof compositionInputSchema>;
export type StepSummary = z.infer<typeof stepSummarySchema>;
