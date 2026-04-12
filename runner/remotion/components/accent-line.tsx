import { interpolate, useCurrentFrame } from 'remotion';

interface AccentLineProps {
  brandColor: string;
  maxWidth?: number;
  startFrame?: number;
  endFrame?: number;
}

/**
 * Animated accent line with gradient fade at edges.
 */
export function AccentLine({
  brandColor,
  maxWidth = 80,
  startFrame = 18,
  endFrame = 38,
}: AccentLineProps) {
  const frame = useCurrentFrame();

  const width = interpolate(frame, [startFrame, endFrame], [0, maxWidth], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width,
        height: 3,
        background: `linear-gradient(90deg, transparent, ${brandColor}, transparent)`,
        borderRadius: 2,
      }}
    />
  );
}
