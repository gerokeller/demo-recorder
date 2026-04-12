import { z } from 'zod';

const selectorSchema = z.string().min(1, 'Selector must not be empty');

/** Pacing hint for controlling how long a step holds the viewer's attention. */
const pacingSchema = z.enum(['quick', 'normal', 'slow', 'dramatic']).optional().default('normal');

export type Pacing = z.infer<typeof pacingSchema>;

/**
 * Narrative beat classifying where a step sits in the story arc.
 * Drives beat-transition chips and tighter per-beat pacing floors.
 */
const beatSchema = z.enum(['setup', 'action', 'payoff', 'close']).optional();

export type Beat = z.infer<typeof beatSchema>;

/**
 * Visual emphasis for the annotation caption.
 *
 * - `normal` (default): standard glassmorphism pill.
 * - `strong`: larger title-card variant for "money shot" payoff moments.
 */
const emphasisSchema = z.enum(['normal', 'strong']).optional().default('normal');

export type Emphasis = z.infer<typeof emphasisSchema>;

/**
 * Shared narrative fields applied to every action step. Kept in a single
 * object so every step schema spreads the same set without drift.
 */
const narrativeFields = {
  annotation: z.string().optional(),
  pacing: pacingSchema,
  beat: beatSchema,
  emphasis: emphasisSchema,
  /** Skip this step when replaying on mobile (desktop-only interaction). */
  mobileSkip: z.boolean().optional().default(false),
  /**
   * Replace this step's selector when replaying on mobile. Useful when the
   * mobile layout uses a different control (e.g., a hamburger menu).
   */
  mobileSelector: selectorSchema.optional(),
  /** Replace this step's path when replaying on mobile. */
  mobilePath: z.string().startsWith('/').optional(),
};

/** Reusable schema for path segments that must not contain path separators. */
const fileSegmentSchema = z
  .string()
  .min(1)
  .regex(/^[^/\\]+$/, 'Must not contain path separators');

const navigateStepSchema = z.object({
  action: z.literal('navigate'),
  path: z.string().startsWith('/'),
  waitFor: selectorSchema.optional(),
  ...narrativeFields,
});

const clickStepSchema = z.object({
  action: z.literal('click'),
  selector: selectorSchema,
  waitFor: selectorSchema.optional(),
  ...narrativeFields,
});

const typeStepSchema = z.object({
  action: z.literal('type'),
  selector: selectorSchema,
  text: z.string(),
  typeDelay: z.number().int().positive().optional(),
  ...narrativeFields,
});

const scrollStepSchema = z.object({
  action: z.literal('scroll'),
  direction: z.enum(['up', 'down']),
  amount: z.number().int().positive().optional().default(300),
  ...narrativeFields,
});

const pauseStepSchema = z.object({
  action: z.literal('pause'),
  duration: z.number().int().positive(),
  /** Pause steps can still carry beat info so cuts align with the arc. */
  beat: beatSchema,
});

const highlightStepSchema = z.object({
  action: z.literal('highlight'),
  selector: selectorSchema,
  duration: z.number().int().positive().optional().default(2000),
  ...narrativeFields,
});

const screenshotStepSchema = z.object({
  action: z.literal('screenshot'),
  name: fileSegmentSchema.optional(),
  beat: beatSchema,
  mobileSkip: z.boolean().optional().default(false),
});

/**
 * POM (Page Object Model) escape hatch for reusing E2E test infrastructure.
 *
 * Valid `page` values are whatever your POM barrel exports (named exports of
 * classes that take a Playwright `Page` in their constructor). Point the
 * `DEMO_POM_MODULE` env var at the module path before running the recorder;
 * omit `pom` steps entirely if you don't use Page Object Models.
 */
const pomStepSchema = z.object({
  action: z.literal('pom'),
  page: z.string(),
  method: z.string(),
  args: z.array(z.unknown()).optional(),
  ...narrativeFields,
});

export const stepSchema = z.discriminatedUnion('action', [
  navigateStepSchema,
  clickStepSchema,
  typeStepSchema,
  scrollStepSchema,
  pauseStepSchema,
  highlightStepSchema,
  screenshotStepSchema,
  pomStepSchema,
]);

export type Step = z.infer<typeof stepSchema>;

/** Named resolution presets. */
export const QUALITY_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '2k': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
} as const;

export type QualityPreset = keyof typeof QUALITY_PRESETS;

/** Canonical default viewport, derived from QUALITY_PRESETS to avoid drift. */
export const DEFAULT_VIEWPORT = { ...QUALITY_PRESETS['1080p'] };

export const viewportSchema = z.object({
  width: z.number().int().positive().default(DEFAULT_VIEWPORT.width),
  height: z.number().int().positive().default(DEFAULT_VIEWPORT.height),
});

/**
 * Mobile companion recording settings. When enabled, the recorder replays the
 * scenario a second time at a phone viewport and composites both streams
 * side-by-side (desktop + phone frame) in the final render.
 */
export const mobileSettingsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  /** Phone viewport. Defaults to iPhone 14 Pro logical size. */
  viewport: z
    .object({
      width: z.number().int().positive().default(390),
      height: z.number().int().positive().default(844),
    })
    .optional()
    .default({ width: 390, height: 844 }),
  /**
   * Device scale factor for the mobile browser context. Matches the phone
   * emulation heuristics used by Playwright's devices config.
   */
  deviceScaleFactor: z.number().positive().optional().default(3),
  /** User-agent override. Defaults to a modern iOS Safari UA. */
  userAgent: z.string().optional(),
  /**
   * Composition layout in the final render.
   *
   * - `side-by-side` (default): desktop 70% + phone 30% with a device frame.
   * - `pip`: desktop fullscreen with a small phone picture-in-picture.
   * - `sequential`: plays desktop then phone back to back (no compositing).
   */
  layout: z.enum(['side-by-side', 'pip', 'sequential']).optional().default('side-by-side'),
});

export type MobileSettings = z.infer<typeof mobileSettingsSchema>;

export const sequenceSettingsSchema = z.object({
  enabled: z.boolean().optional().default(true),
  /** Override intro duration. Omit to auto-compute from title + description length. */
  introDurationSec: z.number().int().positive().optional(),
  /** Override outro duration. Omit to auto-compute from step count + annotation length. */
  outroDurationSec: z.number().int().positive().optional(),
  brandColor: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'brandColor must be a valid hex color')
    .optional()
    .default('#3b82f6'),
  /** Category badge shown in intro/outro (e.g., "Feature Demo", "Bug Fix"). */
  category: z.string().optional(),
  /** Sprint label shown in intro date line (e.g., "Sprint 42"). */
  sprintLabel: z.string().optional(),
  /** Organization name shown in outro footer. */
  orgName: z.string().optional(),
  /** Key takeaway bullets shown in a highlights card in the outro (max 5). */
  highlights: z.array(z.string()).max(5).optional(),
});

export const settingsSchema = z.object({
  auth: fileSegmentSchema.default('ownerUser'),
  baseUrl: z.string().url().optional(),
  quality: z.enum(['720p', '1080p', '2k', '4k']).optional(),
  viewport: viewportSchema.optional().default(DEFAULT_VIEWPORT),
  showAnnotations: z.boolean().optional().default(true),
  sequences: sequenceSettingsSchema.prefault({}),
  /** Spin up an isolated Supabase + Next.js stack for this recording. */
  isolated: z.boolean().optional().default(false),
  /** Record against a Vercel preview deployment instead of local dev server. */
  preview: z.boolean().optional().default(false),
  /** Parallel mobile companion recording settings. */
  mobile: mobileSettingsSchema.prefault({}),
});

/**
 * Optional narrative block emitted by the story director. Viewers see these
 * in the intro/outro; they also help future maintainers understand why the
 * scenario is shaped the way it is.
 */
export const narrativeSchema = z.object({
  persona: z.string().optional(),
  setup: z.string().optional(),
  incitingMoment: z.string().optional(),
  payoff: z.string().optional(),
  closing: z.string().optional(),
});

export type Narrative = z.infer<typeof narrativeSchema>;

export const scenarioSchema = z.object({
  name: fileSegmentSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  narrative: narrativeSchema.optional(),
  settings: settingsSchema.prefault({}),
  steps: z.array(stepSchema).min(1, 'Scenario must have at least one step'),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioSettings = z.infer<typeof settingsSchema>;
export type SequenceSettings = z.infer<typeof sequenceSettingsSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
