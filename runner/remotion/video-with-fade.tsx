import type React from 'react';
import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { COLORS, CROSSFADE_FRAMES } from './styles.ts';

interface VideoWithFadeProps {
  videoSrc: string;
  /** Mobile companion video, rendered side-by-side or PiP when provided. */
  mobileVideoSrc?: string;
  /** Logical dimensions of the desktop recording. */
  desktopAspect?: { width: number; height: number };
  /** Logical dimensions of the mobile recording. */
  mobileAspect?: { width: number; height: number };
  /** Composition layout, defaults to `side-by-side`. */
  layout?: 'side-by-side' | 'pip' | 'sequential';
}

/**
 * Wraps OffthreadVideo with fade-in at the start and fade-out at the end
 * to create smooth crossfade transitions with adjacent sequences. When a
 * mobile companion video is supplied, composites both streams according to
 * the requested layout.
 */
export function VideoWithFade({
  videoSrc,
  mobileVideoSrc,
  desktopAspect,
  mobileAspect,
  layout = 'side-by-side',
}: VideoWithFadeProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, CROSSFADE_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - CROSSFADE_FRAMES, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }
  );

  const opacity = fadeIn * fadeOut;

  // Desktop-only: original behavior.
  if (!mobileVideoSrc) {
    return (
      <AbsoluteFill style={{ opacity }}>
        <OffthreadVideo src={staticFile(videoSrc)} />
      </AbsoluteFill>
    );
  }

  if (layout === 'pip') {
    return (
      <AbsoluteFill style={{ opacity, background: COLORS.background }}>
        <OffthreadVideo src={staticFile(videoSrc)} />
        <PhoneFrame videoSrc={mobileVideoSrc} aspect={mobileAspect} placement="bottom-right" />
      </AbsoluteFill>
    );
  }

  if (layout === 'sequential') {
    // Sequential playback: desktop for first half, mobile for second.
    const halfway = Math.floor(durationInFrames / 2);
    return (
      <AbsoluteFill style={{ opacity, background: COLORS.background }}>
        {frame < halfway ? (
          <OffthreadVideo src={staticFile(videoSrc)} />
        ) : (
          <PhoneFrame videoSrc={mobileVideoSrc} aspect={mobileAspect} placement="centered" />
        )}
      </AbsoluteFill>
    );
  }

  // Side-by-side. Parallel step execution guarantees both streams share the
  // same duration and step boundaries, so we can play both continuously.
  return (
    <AbsoluteFill style={{ opacity, background: COLORS.background }}>
      <SideBySideShell
        desktopAspect={desktopAspect}
        mobileAspect={mobileAspect}
        renderDesktop={({ width, height }) => (
          <div style={desktopInnerStyle(width, height)}>
            <OffthreadVideo src={staticFile(videoSrc)} style={{ width: '100%', height: '100%' }} />
          </div>
        )}
        renderMobile={({ width, height }) => (
          <PhoneShell width={width} height={height}>
            <OffthreadVideo
              src={staticFile(mobileVideoSrc)}
              style={{ width: '100%', height: '100%' }}
            />
          </PhoneShell>
        )}
      />
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Shared layout shell
// ---------------------------------------------------------------------------

function SideBySideShell({
  desktopAspect,
  mobileAspect,
  renderDesktop,
  renderMobile,
}: {
  desktopAspect?: { width: number; height: number };
  mobileAspect?: { width: number; height: number };
  renderDesktop: (sizes: { width: number; height: number }) => React.ReactNode;
  renderMobile: (sizes: { width: number; height: number }) => React.ReactNode;
}) {
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();
  const gutter = canvasWidth * 0.005;
  // 80/20 split gives the desktop recording near-native size while the phone
  // still sits comfortably on the side. The canvas widened just enough in
  // render-sequences.ts so these percentages match the underlying pixel math.
  const desktopColW = canvasWidth * 0.8 - gutter;
  const mobileColW = canvasWidth * 0.2 - gutter;

  const desktopAspectRatio = desktopAspect ? desktopAspect.width / desktopAspect.height : 16 / 9;
  // Let the desktop breathe to the full canvas height; aspect ratio still
  // bounds the width so the recording never distorts.
  const desktopFitHeight = Math.min(canvasHeight, desktopColW / desktopAspectRatio);
  const desktopFitWidth = desktopFitHeight * desktopAspectRatio;

  const mobileAspectRatio = mobileAspect ? mobileAspect.width / mobileAspect.height : 390 / 844;
  // Bezel (20px padding) + notch headroom = ~40px total. Constrain height so
  // the phone's total frame width fits inside the mobile column.
  const phoneFrameBezel = 40;
  const maxPhoneHeightByWidth =
    (mobileColW - phoneFrameBezel) / mobileAspectRatio + phoneFrameBezel;
  const phoneFitHeight = Math.min(canvasHeight * 0.94, maxPhoneHeightByWidth);
  const phoneFitWidth = (phoneFitHeight - phoneFrameBezel) * mobileAspectRatio + phoneFrameBezel;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: `${gutter}px`,
        background: `radial-gradient(1200px 600px at 30% 50%, rgba(59, 130, 246, 0.08), transparent 70%), ${COLORS.background}`,
      }}
    >
      <div
        style={{
          width: `${desktopColW}px`,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {renderDesktop({ width: desktopFitWidth, height: desktopFitHeight })}
      </div>
      <div
        style={{
          width: `${mobileColW}px`,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {renderMobile({ width: phoneFitWidth, height: phoneFitHeight })}
      </div>
    </div>
  );
}

function desktopInnerStyle(width: number, height: number): React.CSSProperties {
  return {
    width: `${width}px`,
    height: `${height}px`,
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: '0 30px 70px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06)',
    background: '#000',
    position: 'relative',
  };
}

// ---------------------------------------------------------------------------
// Phone frame shell
// ---------------------------------------------------------------------------

function PhoneShell({
  width,
  height,
  children,
  compact = false,
}: {
  width: number;
  height: number;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const bezel = compact ? 10 : 20;
  const radius = compact ? 28 : 44;
  const innerRadius = radius - bezel;

  return (
    <div
      style={{
        width,
        height,
        borderRadius: radius,
        background: '#0b0f1a',
        padding: bezel,
        boxShadow:
          '0 30px 70px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06), inset 0 0 0 1px rgba(255, 255, 255, 0.04)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: innerRadius,
          overflow: 'hidden',
          background: '#000',
          position: 'relative',
        }}
      >
        {children}
        {!compact && (
          <div
            style={{
              position: 'absolute',
              top: 6,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 96,
              height: 22,
              borderRadius: 999,
              background: '#0b0f1a',
              boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.04)',
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PiP placement (unchanged from original)
// ---------------------------------------------------------------------------

function PhoneFrame({
  videoSrc,
  aspect,
  placement,
}: {
  videoSrc: string;
  aspect?: { width: number; height: number };
  placement: 'bottom-right' | 'centered';
}) {
  const { width: canvasWidth, height: canvasHeight } = useVideoConfig();
  const aspectRatio = aspect ? aspect.width / aspect.height : 390 / 844;

  if (placement === 'centered') {
    const height = canvasHeight * 0.88;
    const width = (height - 80) * aspectRatio + 40;
    return (
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PhoneShell width={width} height={height}>
          <OffthreadVideo src={staticFile(videoSrc)} style={{ width: '100%', height: '100%' }} />
        </PhoneShell>
      </AbsoluteFill>
    );
  }

  // bottom-right PiP
  const height = canvasHeight * 0.42;
  const width = (height - 40) * aspectRatio + 20;
  return (
    <div
      style={{
        position: 'absolute',
        right: canvasWidth * 0.04,
        bottom: canvasHeight * 0.05,
        width,
        height,
      }}
    >
      <PhoneShell width={width} height={height} compact>
        <OffthreadVideo src={staticFile(videoSrc)} style={{ width: '100%', height: '100%' }} />
      </PhoneShell>
    </div>
  );
}
