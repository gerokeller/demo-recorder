import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS } from '../styles.ts';

interface GradientBackgroundProps {
  opacity?: number;
}

/**
 * Animated radial gradient background with a subtle dot grid pattern.
 * The gradient center drifts slowly for a sense of depth.
 */
export function GradientBackground({ opacity = 1 }: GradientBackgroundProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Slow gradient drift across the duration
  const gradientX = interpolate(frame, [0, durationInFrames], [40, 60], {
    extrapolateRight: 'clamp',
  });
  const gradientY = interpolate(frame, [0, durationInFrames], [35, 55], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        background: `radial-gradient(ellipse at ${gradientX}% ${gradientY}%, ${COLORS.backgroundGradientEnd} 0%, ${COLORS.backgroundGradientStart} 70%)`,
      }}
    >
      {/* Dot grid overlay */}
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(circle, rgba(255, 255, 255, 0.04) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
          opacity: interpolate(frame, [8, 20], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      />
    </AbsoluteFill>
  );
}
