import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { AccentLine } from './components/accent-line.tsx';
import { CategoryBadge } from './components/category-badge.tsx';
import { GlassCard } from './components/glass-card.tsx';
import { GradientBackground } from './components/gradient-background.tsx';
import type { CompositionInput, StepSummary } from './composition-schema.ts';
import { COLORS, FONTS, SPRING_SMOOTH, SPRING_SNAPPY } from './styles.ts';

// ---------------------------------------------------------------------------
// Step categorization
// ---------------------------------------------------------------------------

type StepCategory = 'Navigation' | 'Interactions' | 'Data Entry' | 'Observation';

function categorizeAction(action: string): StepCategory {
  switch (action) {
    case 'navigate':
      return 'Navigation';
    case 'click':
    case 'highlight':
      return 'Interactions';
    case 'type':
      return 'Data Entry';
    default:
      return 'Observation';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepRow({
  step,
  index,
  frame,
  fps,
  brandColor,
}: {
  step: StepSummary;
  index: number;
  frame: number;
  fps: number;
  brandColor: string;
}) {
  const enterFrame = 30 + index * 2;
  const progress = spring({
    frame: Math.max(0, frame - enterFrame),
    fps,
    config: SPRING_SNAPPY,
  });
  const x = interpolate(progress, [0, 1], [20, 0]);
  const label = step.annotation ?? step.action;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity: progress,
        transform: `translateX(${x}px)`,
        marginBottom: 7,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: `${brandColor}22`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONTS.mono,
          fontSize: 11,
          fontWeight: 700,
          color: brandColor,
          flexShrink: 0,
        }}
      >
        {step.index}
      </div>
      <div
        style={{
          fontFamily: FONTS.body,
          fontSize: 15,
          color: COLORS.text,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function CategoryHeader({
  label,
  frame,
  enterFrame,
  fps,
}: {
  label: string;
  frame: number;
  enterFrame: number;
  fps: number;
}) {
  const progress = spring({
    frame: Math.max(0, frame - enterFrame),
    fps,
    config: SPRING_SMOOTH,
  });

  return (
    <div
      style={{
        fontFamily: FONTS.mono,
        fontSize: 11,
        fontWeight: 600,
        color: COLORS.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 6,
        marginTop: 10,
        opacity: progress,
      }}
    >
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Outro
// ---------------------------------------------------------------------------

export function OutroSequence({
  title,
  brandColor,
  steps,
  category,
  orgName,
  highlights,
  recordedDate,
  recordingDurationSec,
}: Pick<
  CompositionInput,
  | 'title'
  | 'brandColor'
  | 'steps'
  | 'category'
  | 'orgName'
  | 'highlights'
  | 'recordedDate'
  | 'recordingDurationSec'
>) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Fade in from black
  const fadeIn = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Header entrance
  const headerProgress = spring({
    frame: Math.max(0, frame - 5),
    fps,
    config: SPRING_SMOOTH,
  });

  // Highlights card entrance
  const highlightsProgress = spring({
    frame: Math.max(0, frame - 18),
    fps,
    config: SPRING_SMOOTH,
  });

  // Fade out at the end (last 20 frames)
  const fadeOut = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Build categorized step groups (show all annotated steps)
  const annotatedSteps = steps.filter((s) => s.annotation);

  const grouped = new Map<StepCategory, StepSummary[]>();
  for (const step of annotatedSteps) {
    const cat = categorizeAction(step.action);
    const arr = grouped.get(cat) ?? [];
    arr.push(step);
    grouped.set(cat, arr);
  }
  const categories = [...grouped.entries()];
  const showCategories = categories.length > 1;

  // Pre-compute index map for O(1) lookups in categorized rendering
  const stepIndexMap = new Map(annotatedSteps.map((s, i) => [s, i]));

  // Format recording duration
  const durationStr = recordingDurationSec
    ? `${Math.round(recordingDurationSec)}s recording`
    : undefined;

  // Footer entrance
  const footerOpacity = interpolate(frame, [45, 60], [0, 0.6], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <GradientBackground opacity={fadeIn * fadeOut} />

      <AbsoluteFill
        style={{
          opacity: fadeIn * fadeOut,
          display: 'flex',
          flexDirection: 'column',
          padding: '6% 10%',
        }}
      >
        {/* Header area */}
        <div style={{ opacity: headerProgress, marginBottom: 24 }}>
          {/* Category badge */}
          {category && (
            <div style={{ marginBottom: 16 }}>
              <CategoryBadge label={category} size="compact" />
            </div>
          )}

          <AccentLine brandColor={brandColor} maxWidth={60} startFrame={8} endFrame={25} />

          <div
            style={{
              fontFamily: FONTS.heading,
              fontSize: 36,
              fontWeight: 700,
              color: COLORS.text,
              marginTop: 16,
              marginBottom: 6,
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </div>

          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 13,
              color: COLORS.textMuted,
              display: 'flex',
              gap: 16,
            }}
          >
            <span>{steps.length} steps</span>
            {durationStr && <span>{durationStr}</span>}
          </div>
        </div>

        {/* Highlights card */}
        {highlights && highlights.length > 0 && (
          <div
            style={{
              opacity: highlightsProgress,
              transform: `translateY(${interpolate(highlightsProgress, [0, 1], [10, 0])}px)`,
              marginBottom: 20,
            }}
          >
            <GlassCard>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 10,
                  fontWeight: 600,
                  color: COLORS.accentLight,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 10,
                }}
              >
                Key Highlights
              </div>
              {highlights.map((h, i) => (
                <div
                  key={h}
                  style={{
                    fontFamily: FONTS.body,
                    fontSize: 16,
                    color: COLORS.textSecondary,
                    marginBottom: i < highlights.length - 1 ? 6 : 0,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                  }}
                >
                  <span style={{ color: brandColor, fontSize: 10, flexShrink: 0 }}>{'\u25CF'}</span>
                  <span>{h}</span>
                </div>
              ))}
            </GlassCard>
          </div>
        )}

        {/* Steps summary — two-column layout to show all steps */}
        <div
          style={{
            flex: 1,
            columns: 2,
            columnGap: 36,
            overflow: 'hidden',
          }}
        >
          {showCategories
            ? categories.map(([cat, catSteps]) => {
                const firstIdx = stepIndexMap.get(catSteps[0]) ?? 0;
                return (
                  <div key={cat} style={{ breakInside: 'avoid' }}>
                    <CategoryHeader
                      label={cat}
                      frame={frame}
                      enterFrame={28 + firstIdx * 2}
                      fps={fps}
                    />
                    {catSteps.map((step) => (
                      <StepRow
                        key={step.index}
                        step={step}
                        index={stepIndexMap.get(step) ?? 0}
                        frame={frame}
                        fps={fps}
                        brandColor={brandColor}
                      />
                    ))}
                  </div>
                );
              })
            : annotatedSteps.map((step, i) => (
                <StepRow
                  key={step.index}
                  step={step}
                  index={i}
                  frame={frame}
                  fps={fps}
                  brandColor={brandColor}
                />
              ))}
        </div>

        {/* Footer bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 16,
            borderTop: `1px solid ${COLORS.surfaceBorder}`,
            opacity: footerOpacity,
          }}
        >
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 12,
              color: COLORS.textMuted,
            }}
          >
            {recordedDate ??
              new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
          </span>
          {orgName && (
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 12,
                color: COLORS.textMuted,
              }}
            >
              {orgName}
            </span>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
