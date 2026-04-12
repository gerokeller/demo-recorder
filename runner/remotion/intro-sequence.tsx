import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { AccentLine } from './components/accent-line.tsx';
import { CategoryBadge } from './components/category-badge.tsx';
import { GradientBackground } from './components/gradient-background.tsx';
import type { CompositionInput } from './composition-schema.ts';
import { COLORS, FONTS, SPRING_SMOOTH } from './styles.ts';

export function IntroSequence({
  title,
  description,
  brandColor,
  category,
  sprintLabel,
}: Pick<CompositionInput, 'title' | 'description' | 'brandColor' | 'category' | 'sprintLabel'>) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Background fade in (frames 0-15)
  const bgOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Category badge (frames 10-25)
  const badgeProgress = spring({
    frame: Math.max(0, frame - 10),
    fps,
    config: SPRING_SMOOTH,
  });

  // Title slides up with spring + subtle scale (starts at frame 12)
  const titleProgress = spring({
    frame: Math.max(0, frame - 12),
    fps,
    config: SPRING_SMOOTH,
  });
  const titleY = interpolate(titleProgress, [0, 1], [40, 0]);
  const titleScale = interpolate(titleProgress, [0, 1], [0.97, 1]);

  // Description fades in (starts at frame 28)
  const descOpacity = interpolate(frame, [28, 45], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const descY = interpolate(frame, [28, 45], [15, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Sprint/date badge (fades in late, subtle)
  const dateBadgeOpacity = interpolate(frame, [50, 65], [0, 0.5], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fade out with upward parallax (last 20 frames)
  const fadeOutStart = durationInFrames - 20;
  const fadeOut = interpolate(frame, [fadeOutStart, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const parallaxY = interpolate(frame, [fadeOutStart, durationInFrames], [0, -20], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <GradientBackground opacity={bgOpacity * fadeOut} />

      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '10%',
          opacity: fadeOut,
          transform: `translateY(${parallaxY}px)`,
        }}
      >
        {/* Category badge */}
        {category && (
          <div
            style={{
              opacity: badgeProgress,
              transform: `translateY(${interpolate(badgeProgress, [0, 1], [10, 0])}px)`,
              marginBottom: 28,
            }}
          >
            <CategoryBadge label={category} />
          </div>
        )}

        {/* Accent line */}
        <div style={{ marginBottom: 32 }}>
          <AccentLine brandColor={brandColor} />
        </div>

        {/* Title */}
        <div
          style={{
            fontFamily: FONTS.heading,
            fontSize: 64,
            fontWeight: 700,
            color: COLORS.text,
            textAlign: 'center',
            opacity: titleProgress,
            transform: `translateY(${titleY}px) scale(${titleScale})`,
            lineHeight: 1.15,
            maxWidth: '80%',
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </div>

        {/* Description */}
        <div
          style={{
            fontFamily: FONTS.body,
            fontSize: 22,
            color: COLORS.textSecondary,
            textAlign: 'center',
            opacity: descOpacity,
            transform: `translateY(${descY}px)`,
            marginTop: 24,
            maxWidth: '70%',
            lineHeight: 1.5,
            letterSpacing: '0.01em',
          }}
        >
          {description}
        </div>

        {/* Sprint / date badge */}
        {sprintLabel && (
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 13,
              color: COLORS.textMuted,
              marginTop: 40,
              opacity: dateBadgeOpacity,
              letterSpacing: '0.05em',
            }}
          >
            {sprintLabel}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
