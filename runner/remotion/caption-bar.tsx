import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS, FONTS } from './styles.ts';

export type BeatValue = 'setup' | 'action' | 'payoff' | 'close' | null;
export type EmphasisValue = 'normal' | 'strong' | null;

interface CaptionBarProps {
  /** End-of-step timestamps, ms from the start of the recording segment. */
  stepTimestamps: number[];
  stepAnnotations: (string | null)[];
  stepBeats: BeatValue[];
  stepEmphases: EmphasisValue[];
  stepActions: string[];
  /** Height of the caption strip in canvas pixels. */
  height: number;
  /** Width of the caption strip in canvas pixels. */
  width: number;
}

const BEAT_LABELS: Record<NonNullable<BeatValue>, string> = {
  setup: 'Setup',
  action: 'The moment',
  payoff: 'Payoff',
  close: 'Takeaway',
};

function actionIcon(action: string): string {
  switch (action) {
    case 'navigate':
      return '\u2192';
    case 'click':
      return '\u25CF';
    case 'type':
      return '\u2328';
    case 'highlight':
      return '\u25C9';
    case 'scroll':
      return '\u2195';
    default:
      return '';
  }
}

/**
 * Bottom caption strip: a single pill shared across desktop and mobile so
 * the story reads the same on both sides. The pill shows the current step's
 * annotation, beat label, action icon, and overall progress. It cross-fades
 * between steps at their timestamp boundaries.
 */
export function CaptionBar({
  stepTimestamps,
  stepAnnotations,
  stepBeats,
  stepEmphases,
  stepActions,
  height,
  width,
}: CaptionBarProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  // Resolve which step index the current frame falls into.
  let currentIdx = 0;
  for (let i = 0; i < stepTimestamps.length; i++) {
    if (nowMs < stepTimestamps[i]) {
      currentIdx = i;
      break;
    }
    if (i === stepTimestamps.length - 1) currentIdx = i;
  }

  const stepStartMs = currentIdx > 0 ? stepTimestamps[currentIdx - 1] : 0;
  const stepEndMs = stepTimestamps[currentIdx] ?? stepStartMs;
  const stepDurationMs = Math.max(1, stepEndMs - stepStartMs);
  const timeInStepMs = nowMs - stepStartMs;

  const annotation = stepAnnotations[currentIdx] ?? '';
  const beat = stepBeats[currentIdx];
  const emphasis = stepEmphases[currentIdx] ?? 'normal';
  const action = stepActions[currentIdx] ?? '';
  const totalSteps = stepTimestamps.length;

  // Cross-fade the pill across the first 300ms / last 250ms of the step.
  // Steps without an annotation still hold a faint structural element so
  // the bar doesn't flicker between populated and empty states.
  const fadeInMs = 300;
  const fadeOutMs = 250;
  const fadeIn = interpolate(timeInStepMs, [0, fadeInMs], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(
    timeInStepMs,
    [stepDurationMs - fadeOutMs, stepDurationMs],
    [1, 0],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );
  const opacity = annotation ? fadeIn * fadeOut : 0;

  // Progress: overall scenario progression, not per-step.
  const overallProgress = (currentIdx + 1) / totalSteps;

  const isStrong = emphasis === 'strong';

  return (
    <AbsoluteFill
      style={{
        width,
        height,
        background: `linear-gradient(180deg, rgba(10, 15, 28, 0) 0%, rgba(10, 15, 28, 0.85) 40%, rgba(8, 12, 24, 0.95) 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 48px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: Math.min(width * 0.9, 1600),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          opacity,
          transform: `translateY(${(1 - fadeIn) * 6}px)`,
        }}
      >
        {/* Annotation pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: isStrong ? '20px 36px' : '14px 30px',
            background: 'rgba(15, 23, 42, 0.92)',
            border: isStrong
              ? '1px solid rgba(96, 165, 250, 0.55)'
              : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 999,
            boxShadow: isStrong
              ? '0 0 0 1px rgba(0, 0, 0, 0.35), 0 20px 60px rgba(0, 0, 0, 0.55), 0 0 40px rgba(59, 130, 246, 0.25)'
              : '0 0 0 1px rgba(0, 0, 0, 0.25), 0 12px 40px rgba(0, 0, 0, 0.45)',
            fontFamily: FONTS.body,
            color: COLORS.text,
          }}
        >
          <span
            style={{
              padding: '5px 10px',
              background: 'rgba(59, 130, 246, 0.28)',
              color: '#93c5fd',
              fontFamily: FONTS.mono,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.04em',
              borderRadius: 7,
              border: '1px solid rgba(96, 165, 250, 0.35)',
            }}
          >
            {`${currentIdx + 1}/${totalSteps}`}
          </span>
          {beat ? (
            <span
              style={{
                padding: '5px 12px',
                background: 'rgba(96, 165, 250, 0.1)',
                color: '#bfdbfe',
                fontSize: 13,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                borderRadius: 6,
                border: '1px solid rgba(96, 165, 250, 0.18)',
              }}
            >
              {BEAT_LABELS[beat]}
            </span>
          ) : null}
          <span style={{ opacity: 0.7, fontSize: 18, color: '#93c5fd' }}>{actionIcon(action)}</span>
          <span
            style={{
              fontSize: isStrong ? 26 : 20,
              fontWeight: isStrong ? 700 : 600,
              lineHeight: 1.3,
              letterSpacing: '-0.005em',
              textShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
            }}
          >
            {annotation}
          </span>
        </div>

        {/* Progress bar */}
        <div
          style={{
            width: '100%',
            height: 3,
            background: 'rgba(255, 255, 255, 0.08)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${overallProgress * 100}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              borderRadius: 2,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}

/**
 * Beat transition chip: overlays the video area when a new beat begins.
 * Rendered on the canvas (not in the recording) so both desktop and mobile
 * see the same chip at the same moment.
 */
interface BeatChipOverlayProps {
  stepTimestamps: number[];
  stepBeats: BeatValue[];
  /** Vertical extent of the video area (chip is centered within it). */
  videoHeight: number;
  /** Horizontal extent of the canvas. */
  width: number;
}

const BEAT_ICONS: Record<NonNullable<BeatValue>, string> = {
  setup: '\u25AB',
  action: '\u25B8',
  payoff: '\u2605',
  close: '\u2713',
};

export function BeatChipOverlay({
  stepTimestamps,
  stepBeats,
  videoHeight,
  width,
}: BeatChipOverlayProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  // Determine if we're inside the first 1000ms of a step whose beat differs
  // from the previous step. Those steps get a chip at the canvas center.
  let activeBeat: BeatValue = null;
  let stepStartMs = 0;
  for (let i = 0; i < stepBeats.length; i++) {
    const prevBeat: BeatValue = i > 0 ? stepBeats[i - 1] : null;
    const start = i > 0 ? stepTimestamps[i - 1] : 0;
    const end = stepTimestamps[i];
    if (nowMs >= start && nowMs < end) {
      const beatChanged = stepBeats[i] !== null && stepBeats[i] !== prevBeat;
      if (beatChanged && nowMs - start < 1100) {
        activeBeat = stepBeats[i];
        stepStartMs = start;
      }
      break;
    }
  }

  if (!activeBeat) return null;

  const elapsedMs = nowMs - stepStartMs;
  const fadeIn = interpolate(elapsedMs, [0, 250], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeOut = interpolate(elapsedMs, [800, 1100], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = fadeIn * fadeOut;

  return (
    <AbsoluteFill style={{ width, height: videoHeight, pointerEvents: 'none', opacity }}>
      <AbsoluteFill style={{ background: 'rgba(0, 0, 0, 0.45)' }} />
      <AbsoluteFill
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '20px 40px',
            background: 'rgba(15, 23, 42, 0.94)',
            border: '1px solid rgba(96, 165, 250, 0.5)',
            borderRadius: 999,
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.55), 0 0 50px rgba(59, 130, 246, 0.3)',
            color: COLORS.text,
            fontFamily: FONTS.body,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: '0.02em',
          }}
        >
          <span style={{ color: '#60a5fa', fontSize: 28 }}>{BEAT_ICONS[activeBeat]}</span>
          <span>{BEAT_LABELS[activeBeat]}</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
