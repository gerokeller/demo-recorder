import { Composition, registerRoot } from 'remotion';
import { compositionInputSchema } from './composition-schema.ts';
import { DemoVideo } from './demo-video.tsx';
import { CROSSFADE_FRAMES, FPS } from './styles.ts';

/**
 * Remotion entry point. Registers the demo-video composition whose
 * duration and dimensions are derived from inputProps at render time.
 *
 * Total duration accounts for crossfade overlaps: the intro/video
 * and video/outro sequences overlap by CROSSFADE_FRAMES each.
 */
function RemotionRoot() {
  return (
    <Composition
      id="demo-video"
      component={DemoVideo}
      schema={compositionInputSchema}
      calculateMetadata={async ({ props }) => ({
        durationInFrames:
          props.introDurationFrames +
          props.videoDurationFrames +
          props.outroDurationFrames -
          2 * CROSSFADE_FRAMES,
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
      defaultProps={{
        title: 'Demo',
        description: '',
        videoSrc: 'recorded.webm',
        videoDurationFrames: 300,
        fps: FPS,
        width: 1920,
        height: 1080,
        introDurationFrames: 120,
        outroDurationFrames: 180,
        brandColor: '#3b82f6',
        steps: [],
      }}
    />
  );
}

registerRoot(RemotionRoot);
