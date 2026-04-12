/** Shared style constants for intro/outro sequences. */

import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono';

const { fontFamily: interFamily } = loadInter();
const { fontFamily: jetBrainsFamily } = loadJetBrainsMono();

export const COLORS = {
  background: '#0f172a',
  backgroundGradientStart: '#0f172a',
  backgroundGradientEnd: '#1a1a2e',
  surface: '#1e293b',
  surfaceGlass: 'rgba(255, 255, 255, 0.05)',
  surfaceBorder: 'rgba(255, 255, 255, 0.08)',
  accent: '#3b82f6',
  accentLight: '#60a5fa',
  accentGlow: 'rgba(59, 130, 246, 0.15)',
  text: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
  success: '#22c55e',
} as const;

export const FONTS = {
  heading: `${interFamily}, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
  body: `${interFamily}, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
  mono: `${jetBrainsFamily}, "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace`,
} as const;

export const SPRING_SMOOTH = { damping: 20, mass: 0.8, stiffness: 100 } as const;
export const SPRING_SNAPPY = { damping: 15, mass: 0.5, stiffness: 200 } as const;

export const FPS = 30;

/** Frames for crossfade transitions between sequences. */
export const CROSSFADE_FRAMES = 15;
