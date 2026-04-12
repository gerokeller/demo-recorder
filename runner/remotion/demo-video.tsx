import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { BeatChipOverlay, CaptionBar } from './caption-bar.tsx';
import type { CompositionInput } from './composition-schema.ts';
import { IntroSequence } from './intro-sequence.tsx';
import { OutroSequence } from './outro-sequence.tsx';
import { CROSSFADE_FRAMES } from './styles.ts';
import { VideoWithFade } from './video-with-fade.tsx';

export function DemoVideo(props: CompositionInput) {
  const {
    title,
    description,
    videoSrc,
    width,
    height,
    introDurationFrames,
    videoDurationFrames,
    outroDurationFrames,
    brandColor,
    steps,
    category,
    sprintLabel,
    orgName,
    highlights,
    recordedDate,
    recordingDurationSec,
    desktopVideoWidth,
    desktopVideoHeight,
    mobileVideoSrc,
    mobileWidth,
    mobileHeight,
    mobileLayout,
    stepTimestamps,
    stepAnnotations,
    stepBeats,
    stepEmphases,
    stepActions,
    useCanvasCaptions,
    captionBarHeight,
    voiceOverClips,
    fps,
  } = props;

  // Crossfade overlap: intro and video overlap by CROSSFADE_FRAMES,
  // and video and outro overlap by CROSSFADE_FRAMES.
  const videoStart = introDurationFrames - CROSSFADE_FRAMES;
  const outroStart = videoStart + videoDurationFrames - CROSSFADE_FRAMES;

  // When canvas captions are on, the video area occupies the top portion of
  // the composition (excluding the caption bar height). Otherwise the videos
  // fill the full canvas as before.
  const barH = useCanvasCaptions && captionBarHeight ? captionBarHeight : 0;
  const videoZoneHeight = height - barH;

  const hasCaptionData =
    useCanvasCaptions &&
    Array.isArray(stepTimestamps) &&
    Array.isArray(stepAnnotations) &&
    Array.isArray(stepBeats) &&
    Array.isArray(stepEmphases) &&
    Array.isArray(stepActions);

  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={introDurationFrames}>
        <IntroSequence
          title={title}
          description={description}
          brandColor={brandColor}
          category={category}
          sprintLabel={sprintLabel}
        />
      </Sequence>

      {/* Voice-over: one Audio per step, anchored to step start time. */}
      {voiceOverClips && stepTimestamps
        ? voiceOverClips.map((clip) => {
            const stepStartMs = clip.stepIndex > 0 ? stepTimestamps[clip.stepIndex - 1] : 0;
            const startFrame = videoStart + Math.round((stepStartMs / 1000) * fps);
            const durationFrames = Math.max(1, Math.ceil(clip.durationSec * fps));
            return (
              <Sequence
                key={`vo-${clip.stepIndex}`}
                from={startFrame}
                durationInFrames={durationFrames}
              >
                <Audio src={staticFile(clip.src)} />
              </Sequence>
            );
          })
        : null}

      <Sequence from={videoStart} durationInFrames={videoDurationFrames}>
        <AbsoluteFill>
          {/* Video zone: top of the canvas */}
          <div style={{ position: 'absolute', top: 0, left: 0, width, height: videoZoneHeight }}>
            <VideoWithFade
              videoSrc={videoSrc}
              mobileVideoSrc={mobileVideoSrc}
              desktopAspect={
                desktopVideoWidth && desktopVideoHeight
                  ? { width: desktopVideoWidth, height: desktopVideoHeight }
                  : { width, height: videoZoneHeight }
              }
              mobileAspect={
                mobileWidth && mobileHeight
                  ? { width: mobileWidth, height: mobileHeight }
                  : undefined
              }
              layout={mobileLayout ?? 'side-by-side'}
            />
          </div>

          {/* Beat chip overlay on the video area */}
          {hasCaptionData && stepTimestamps && stepBeats ? (
            <div style={{ position: 'absolute', top: 0, left: 0, width, height: videoZoneHeight }}>
              <BeatChipOverlay
                stepTimestamps={stepTimestamps}
                stepBeats={stepBeats}
                videoHeight={videoZoneHeight}
                width={width}
              />
            </div>
          ) : null}

          {/* Caption bar: bottom strip */}
          {hasCaptionData &&
          barH > 0 &&
          stepTimestamps &&
          stepAnnotations &&
          stepBeats &&
          stepEmphases &&
          stepActions ? (
            <div
              style={{
                position: 'absolute',
                top: videoZoneHeight,
                left: 0,
                width,
                height: barH,
              }}
            >
              <CaptionBar
                stepTimestamps={stepTimestamps}
                stepAnnotations={stepAnnotations}
                stepBeats={stepBeats}
                stepEmphases={stepEmphases}
                stepActions={stepActions}
                height={barH}
                width={width}
              />
            </div>
          ) : null}
        </AbsoluteFill>
      </Sequence>

      <Sequence from={outroStart} durationInFrames={outroDurationFrames}>
        <OutroSequence
          title={title}
          brandColor={brandColor}
          steps={steps}
          category={category}
          orgName={orgName}
          highlights={highlights}
          recordedDate={recordedDate}
          recordingDurationSec={recordingDurationSec}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
