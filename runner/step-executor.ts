import type { Locator, Page } from 'playwright';
import type { Beat, Emphasis, Pacing, Step } from './scenario-schema.ts';

// ---------------------------------------------------------------------------
// Pacing context (tracked across steps)
// ---------------------------------------------------------------------------

export interface PacingContext {
  stepIndex: number;
  totalSteps: number;
  isFirstNavigation: boolean;
  previousAction: string | undefined;
  /** Narrative beat of the previous step, used to detect beat transitions. */
  previousBeat: Beat | undefined;
  /** Input variant for cursor + click visuals. Defaults to `desktop`. */
  inputVariant?: InputVariant;
}

// Track whether an annotation is currently visible (module-level state).
// Call resetAnnotationState() before each recording to avoid stale state.
let annotationVisible = false;

/** Reset module-level state between recordings in the same process. */
export function resetAnnotationState(): void {
  annotationVisible = false;
}

/** Read the narrative beat from any step, if one is set. */
function stepBeat(step: Step): Beat {
  return 'beat' in step ? step.beat : undefined;
}

/** Read the caption emphasis from any step, defaulting to `normal`. */
function stepEmphasis(step: Step): Emphasis {
  return 'emphasis' in step ? (step.emphasis ?? 'normal') : 'normal';
}

// ---------------------------------------------------------------------------
// Selector resolution
// ---------------------------------------------------------------------------

/**
 * Parse a prefixed selector string into a Playwright Locator.
 *
 * Supported prefixes:
 * - heading:Name   -> page.getByRole('heading', { name })
 * - link:Name      -> page.getByRole('link', { name })
 * - link-exact:Name -> page.getByRole('link', { name, exact: true })
 * - button:Name    -> page.getByRole('button', { name })
 * - placeholder:X  -> page.getByPlaceholder(X)
 * - testid:X       -> page.getByTestId(X)
 * - text:X         -> page.getByText(X)
 * - Anything else  -> page.locator(selector)  (CSS selector)
 */
export function resolveSelector(page: Page, selector: string): Locator {
  const colonIndex = selector.indexOf(':');
  if (colonIndex === -1) {
    return page.locator(selector);
  }

  const prefix = selector.slice(0, colonIndex);
  const value = selector.slice(colonIndex + 1);

  switch (prefix) {
    case 'heading':
      return page.getByRole('heading', { name: value });
    case 'link':
      return page.getByRole('link', { name: value });
    case 'link-exact':
      return page.getByRole('link', { name: value, exact: true });
    case 'button':
      return page.getByRole('button', { name: value });
    case 'placeholder':
      return page.getByPlaceholder(value);
    case 'testid':
      return page.getByTestId(value);
    case 'text':
      return page.getByText(value);
    default:
      return page.locator(selector);
  }
}

// ---------------------------------------------------------------------------
// Annotation overlay (glassmorphism pill)
// ---------------------------------------------------------------------------

/** Return a Unicode icon prefix for the given step action. */
function actionIcon(action: string): string {
  switch (action) {
    case 'navigate':
      return '\u2192'; // →
    case 'click':
      return '\u25CF'; // ●
    case 'type':
      return '\u2328'; // ⌨
    case 'highlight':
      return '\u25C9'; // ◉
    case 'scroll':
      return '\u2195'; // ↕
    default:
      return '';
  }
}

/**
 * Show, update, or hide the annotation overlay pill.
 *
 * Readability improvements over the previous design:
 *  - Larger 18px/600 weight caption text (was 15px/500)
 *  - Higher background opacity (0.88 vs 0.75) and subtle outer stroke so the
 *    caption stays legible over light backgrounds.
 *  - Optional `strong` emphasis renders as a larger title-card with a brand
 *    accent strip, reserved for payoff moments.
 */
async function setAnnotation(
  page: Page,
  text: string | undefined,
  stepIndex: number,
  totalSteps: number,
  action: string,
  emphasis: Emphasis = 'normal'
): Promise<void> {
  // If replacing existing visible annotation, crossfade out first
  if (annotationVisible && text) {
    await page.evaluate(() => {
      const overlay = document.getElementById('demo-annotation');
      if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.transform = 'translateX(-50%) translateY(8px)';
      }
    });
    await page.waitForTimeout(350); // fade-out + gap
  }

  await page.evaluate(
    (args: { t: string | null; idx: number; total: number; icon: string; strong: boolean }) => {
      let container = document.getElementById('demo-annotation');
      if (!container) {
        // Inject annotation styles once
        const style = document.createElement('style');
        style.id = 'demo-annotation-styles';
        style.textContent = [
          '#demo-annotation {',
          '  position: fixed; bottom: 40px; left: 50%;',
          '  transform: translateX(-50%) translateY(12px);',
          '  background: rgba(10, 15, 28, 0.88);',
          '  backdrop-filter: blur(20px) saturate(140%);',
          '  -webkit-backdrop-filter: blur(20px) saturate(140%);',
          '  border: 1px solid rgba(255, 255, 255, 0.14);',
          '  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25),',
          '              0 12px 40px rgba(0, 0, 0, 0.45),',
          '              0 2px 6px rgba(0, 0, 0, 0.3);',
          '  border-radius: 18px; padding: 18px 32px 22px;',
          '  font: 600 18px/1.45 Inter, system-ui, sans-serif;',
          '  color: #f8fafc; max-width: min(72%, 1100px); text-align: center;',
          '  letter-spacing: -0.005em;',
          '  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);',
          '  z-index: 99999; opacity: 0; display: none;',
          '  transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),',
          '              transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);',
          '}',
          '#demo-annotation.visible { opacity: 1; transform: translateX(-50%) translateY(0); }',
          '#demo-annotation.strong {',
          '  bottom: 56px;',
          '  padding: 26px 44px 30px;',
          '  font-size: 26px; line-height: 1.35; font-weight: 700;',
          '  max-width: min(76%, 1280px);',
          '  background: linear-gradient(180deg, rgba(15, 23, 42, 0.92) 0%, rgba(12, 18, 36, 0.94) 100%);',
          '  border: 1px solid rgba(96, 165, 250, 0.45);',
          '  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35),',
          '              0 24px 60px rgba(0, 0, 0, 0.55),',
          '              0 0 40px rgba(59, 130, 246, 0.25);',
          '}',
          '#demo-annotation.strong::before {',
          '  content: ""; position: absolute; left: 0; right: 0; top: 0;',
          '  height: 3px; border-radius: 18px 18px 0 0;',
          '  background: linear-gradient(90deg, #3b82f6, #60a5fa, #3b82f6);',
          '}',
          '#demo-annotation-badge {',
          '  display: inline-block;',
          '  background: rgba(59, 130, 246, 0.28); color: #93c5fd;',
          '  font: 700 12px/1 "JetBrains Mono", "SF Mono", monospace;',
          '  padding: 4px 9px; border-radius: 7px;',
          '  margin-right: 12px; vertical-align: baseline;',
          '  letter-spacing: 0.04em;',
          '  border: 1px solid rgba(96, 165, 250, 0.35);',
          '}',
          '#demo-annotation.strong #demo-annotation-badge {',
          '  font-size: 13px; padding: 5px 11px;',
          '}',
          '#demo-annotation-icon {',
          '  margin-right: 8px; opacity: 0.75; font-size: 15px;',
          '  display: inline-block; vertical-align: baseline;',
          '}',
          '#demo-annotation.strong #demo-annotation-icon {',
          '  font-size: 20px; margin-right: 10px;',
          '}',
          '#demo-annotation-progress {',
          '  position: absolute; bottom: 0; left: 18px; right: 18px;',
          '  height: 3px; background: rgba(255, 255, 255, 0.1);',
          '  border-radius: 2px; overflow: hidden;',
          '}',
          '#demo-annotation-progress-bar {',
          '  height: 100%;',
          '  background: linear-gradient(90deg, #3b82f6, #60a5fa);',
          '  border-radius: 2px;',
          '  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);',
          '}',
        ].join('\n');
        document.head.appendChild(style);

        // Build DOM structure with safe methods (no innerHTML)
        container = document.createElement('div');
        container.id = 'demo-annotation';

        const badge = document.createElement('span');
        badge.id = 'demo-annotation-badge';
        container.appendChild(badge);

        const iconEl = document.createElement('span');
        iconEl.id = 'demo-annotation-icon';
        container.appendChild(iconEl);

        const textEl = document.createElement('span');
        textEl.id = 'demo-annotation-text';
        container.appendChild(textEl);

        const progress = document.createElement('div');
        progress.id = 'demo-annotation-progress';
        const progressBar = document.createElement('div');
        progressBar.id = 'demo-annotation-progress-bar';
        progress.appendChild(progressBar);
        container.appendChild(progress);

        document.body.appendChild(container);
      }

      // Toggle strong emphasis class
      container.classList.toggle('strong', args.strong);

      if (args.t) {
        const badge = document.getElementById('demo-annotation-badge');
        const icon = document.getElementById('demo-annotation-icon');
        const textEl = document.getElementById('demo-annotation-text');
        const bar = document.getElementById('demo-annotation-progress-bar');
        if (badge) badge.textContent = `${args.idx}/${args.total}`;
        if (icon) icon.textContent = args.icon;
        if (textEl) textEl.textContent = args.t;
        if (bar) bar.style.width = `${(args.idx / args.total) * 100}%`;

        container.style.display = 'block';
        // Force reflow before adding class for transition
        void container.offsetHeight;
        container.classList.add('visible');
      } else {
        container.classList.remove('visible');
        setTimeout(() => {
          if (container && !container.classList.contains('visible')) {
            container.style.display = 'none';
          }
        }, 400);
      }
    },
    {
      t: text ?? null,
      idx: stepIndex,
      total: totalSteps,
      icon: text ? actionIcon(action) : '',
      strong: emphasis === 'strong',
    }
  );

  annotationVisible = !!text;
}

// ---------------------------------------------------------------------------
// Beat transition chip (scene change marker between narrative beats)
// ---------------------------------------------------------------------------

const BEAT_CHIP_LABELS: Record<NonNullable<Beat>, string> = {
  setup: 'Setup',
  action: 'The moment',
  payoff: 'Payoff',
  close: 'Takeaway',
};

const BEAT_CHIP_ICONS: Record<NonNullable<Beat>, string> = {
  setup: '\u25AB', // ▫
  action: '\u25B8', // ▸
  payoff: '\u2605', // ★
  close: '\u2713', // ✓
};

/**
 * Show a brief beat-transition chip with a soft dim behind it. This gives
 * the viewer a clear scene change between story beats without relying on
 * them reading the caption to figure out what just shifted.
 *
 * Total on-screen time: ~1000ms (fade in 200ms, hold 600ms, fade out 200ms).
 */
async function showBeatChip(page: Page, beat: NonNullable<Beat>): Promise<void> {
  const label = BEAT_CHIP_LABELS[beat];
  const icon = BEAT_CHIP_ICONS[beat];

  await page.evaluate(
    (args: { label: string; icon: string }) => {
      if (!document.getElementById('demo-beat-chip-styles')) {
        const style = document.createElement('style');
        style.id = 'demo-beat-chip-styles';
        style.textContent = [
          '#demo-beat-dim {',
          '  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);',
          '  pointer-events: none; z-index: 99996; opacity: 0;',
          '  transition: opacity 0.25s ease;',
          '}',
          '#demo-beat-dim.visible { opacity: 1; }',
          '#demo-beat-chip {',
          '  position: fixed; top: 50%; left: 50%;',
          '  transform: translate(-50%, -50%) scale(0.92);',
          '  padding: 16px 32px; border-radius: 999px;',
          '  background: rgba(15, 23, 42, 0.92);',
          '  border: 1px solid rgba(96, 165, 250, 0.45);',
          '  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55),',
          '              0 0 40px rgba(59, 130, 246, 0.3);',
          '  font: 700 20px/1 Inter, system-ui, sans-serif;',
          '  color: #f8fafc; letter-spacing: 0.02em;',
          '  z-index: 99997; opacity: 0;',
          '  transition: opacity 0.25s ease, transform 0.35s cubic-bezier(0.2, 0.7, 0.2, 1);',
          '}',
          '#demo-beat-chip.visible {',
          '  opacity: 1; transform: translate(-50%, -50%) scale(1);',
          '}',
          '#demo-beat-chip-icon {',
          '  display: inline-block; margin-right: 10px;',
          '  color: #60a5fa; font-size: 22px; vertical-align: baseline;',
          '}',
        ].join('\n');
        document.head.appendChild(style);
      }

      let dim = document.getElementById('demo-beat-dim');
      if (!dim) {
        dim = document.createElement('div');
        dim.id = 'demo-beat-dim';
        document.body.appendChild(dim);
      }
      let chip = document.getElementById('demo-beat-chip');
      if (!chip) {
        chip = document.createElement('div');
        chip.id = 'demo-beat-chip';
        const iconEl = document.createElement('span');
        iconEl.id = 'demo-beat-chip-icon';
        chip.appendChild(iconEl);
        const labelEl = document.createElement('span');
        labelEl.id = 'demo-beat-chip-label';
        chip.appendChild(labelEl);
        document.body.appendChild(chip);
      }

      const iconEl = document.getElementById('demo-beat-chip-icon');
      const labelEl = document.getElementById('demo-beat-chip-label');
      if (iconEl) iconEl.textContent = args.icon;
      if (labelEl) labelEl.textContent = args.label;

      dim.classList.add('visible');
      void chip.offsetHeight;
      chip.classList.add('visible');
    },
    { label, icon }
  );

  await page.waitForTimeout(800); // hold

  await page.evaluate(() => {
    const dim = document.getElementById('demo-beat-dim');
    const chip = document.getElementById('demo-beat-chip');
    if (dim) dim.classList.remove('visible');
    if (chip) chip.classList.remove('visible');
  });

  await page.waitForTimeout(250); // fade out
}

// ---------------------------------------------------------------------------
// Highlight (glow ring + spotlight overlay)
// ---------------------------------------------------------------------------

/**
 * Inject highlight styles once (keyframes + spotlight overlay).
 */
async function ensureHighlightStyles(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById('demo-highlight-styles')) return;
    const style = document.createElement('style');
    style.id = 'demo-highlight-styles';
    style.textContent = [
      '@keyframes demo-highlight-pulse {',
      '  0%, 100% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.6), 0 0 20px rgba(59, 130, 246, 0.3); }',
      '  50% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.8), 0 0 30px rgba(59, 130, 246, 0.5); }',
      '}',
      '.demo-highlighted {',
      '  animation: demo-highlight-pulse 1.5s ease-in-out infinite !important;',
      '  border-radius: inherit; position: relative; z-index: 10000;',
      '}',
      '#demo-spotlight {',
      '  position: fixed; inset: 0;',
      '  background: rgba(0, 0, 0, 0.3);',
      '  pointer-events: none; z-index: 9999;',
      '  opacity: 0; transition: opacity 0.3s ease;',
      '}',
      '#demo-spotlight.active { opacity: 1; }',
    ].join('\n');
    document.head.appendChild(style);
  });
}

/**
 * Highlight an element with a pulsing glow ring and spotlight overlay.
 */
async function highlightElement(page: Page, locator: Locator, durationMs: number): Promise<void> {
  const handle = await locator.elementHandle();
  if (!handle) return;

  await ensureHighlightStyles(page);

  // Create spotlight overlay and add glow class
  await page.evaluate((el: Element) => {
    let spotlight = document.getElementById('demo-spotlight');
    if (!spotlight) {
      spotlight = document.createElement('div');
      spotlight.id = 'demo-spotlight';
      document.body.appendChild(spotlight);
    }
    spotlight.classList.add('active');
    (el as HTMLElement).classList.add('demo-highlighted');
  }, handle);

  await page.waitForTimeout(durationMs);

  // Clean up
  await page.evaluate((el: Element) => {
    (el as HTMLElement).classList.remove('demo-highlighted');
    const spotlight = document.getElementById('demo-spotlight');
    if (spotlight) spotlight.classList.remove('active');
  }, handle);
}

// ---------------------------------------------------------------------------
// Click indicator (ripple effect)
// ---------------------------------------------------------------------------

/**
 * Input variant for cursor + click visuals. Desktop uses a precise cursor,
 * mobile uses a larger touch indicator + tap-ring animation.
 */
export type InputVariant = 'desktop' | 'mobile';

/**
 * Show a visual click indicator at the click position. Desktop shows a
 * mouse-click ripple + center dot; mobile shows a finger-tap animation (two
 * outward pulse rings + inner dot) so it's unmistakable as a touch event.
 */
async function showClickIndicator(
  page: Page,
  locator: Locator,
  variant: InputVariant = 'desktop'
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) return;

  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);

  await page.evaluate(
    ({ cx, cy, v }: { cx: number; cy: number; v: InputVariant }) => {
      if (!document.getElementById('demo-click-style')) {
        const style = document.createElement('style');
        style.id = 'demo-click-style';
        style.textContent = [
          '@keyframes demo-ripple {',
          '  0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0.9; }',
          '  100% { transform: translate(-50%, -50%) scale(1.1); opacity: 0; }',
          '}',
          '@keyframes demo-dot-fade {',
          '  0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }',
          '  70% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }',
          '  100% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }',
          '}',
          '@keyframes demo-tap-ring {',
          '  0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.9; }',
          '  70% { opacity: 0.6; }',
          '  100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }',
          '}',
        ].join('\n');
        document.head.appendChild(style);
      }

      const isMobile = v === 'mobile';
      const rippleSize = isMobile ? 110 : 80;
      const rippleColor = isMobile ? '#60a5fa' : '#3b82f6';
      const rippleWidth = isMobile ? 4 : 3;
      const rippleAnim = isMobile
        ? 'demo-tap-ring 0.7s ease-out forwards'
        : 'demo-ripple 0.65s ease-out forwards';

      // Primary ring
      const ripple = document.createElement('div');
      ripple.style.cssText = [
        'position: fixed',
        `left: ${cx}px`,
        `top: ${cy}px`,
        `width: ${rippleSize}px`,
        `height: ${rippleSize}px`,
        'border-radius: 50%',
        `border: ${rippleWidth}px solid ${rippleColor}`,
        `box-shadow: 0 0 24px ${isMobile ? 'rgba(96, 165, 250, 0.55)' : 'rgba(59, 130, 246, 0.45)'}`,
        'pointer-events: none',
        'z-index: 99998',
        `animation: ${rippleAnim}`,
      ].join('; ');
      document.body.appendChild(ripple);

      // Mobile gets a second lagging ring for a clearer tap feel.
      let ripple2: HTMLDivElement | null = null;
      if (isMobile) {
        ripple2 = document.createElement('div');
        ripple2.style.cssText = [
          'position: fixed',
          `left: ${cx}px`,
          `top: ${cy}px`,
          `width: ${rippleSize}px`,
          `height: ${rippleSize}px`,
          'border-radius: 50%',
          `border: 2px solid ${rippleColor}`,
          'pointer-events: none',
          'z-index: 99998',
          'animation: demo-tap-ring 0.95s ease-out 0.15s forwards',
        ].join('; ');
        document.body.appendChild(ripple2);
      }

      // Center dot
      const dotSize = isMobile ? 26 : 18;
      const dotBg = isMobile ? 'rgba(59, 130, 246, 0.7)' : 'rgba(59, 130, 246, 0.7)';
      const dot = document.createElement('div');
      dot.style.cssText = [
        'position: fixed',
        `left: ${cx}px`,
        `top: ${cy}px`,
        `width: ${dotSize}px`,
        `height: ${dotSize}px`,
        'border-radius: 50%',
        `background: ${dotBg}`,
        `box-shadow: 0 0 16px ${isMobile ? 'rgba(59, 130, 246, 0.8)' : 'rgba(59, 130, 246, 0.6)'}, 0 0 0 2px rgba(255, 255, 255, 0.85)`,
        'pointer-events: none',
        'z-index: 99998',
        'animation: demo-dot-fade 0.75s ease-out forwards',
      ].join('; ');
      document.body.appendChild(dot);

      setTimeout(
        () => {
          ripple.remove();
          ripple2?.remove();
          dot.remove();
        },
        isMobile ? 1200 : 850
      );
    },
    { cx: x, cy: y, v: variant }
  );

  // Brief pause so the indicator is visible in the recording
  await page.waitForTimeout(variant === 'mobile' ? 220 : 170);
}

// ---------------------------------------------------------------------------
// Custom cursor
// ---------------------------------------------------------------------------

/**
 * Inject a visible custom cursor that follows the mouse with click feedback.
 *
 * - `desktop` variant: a precise blue dot with an outer white ring + shadow,
 *   styled like a mouse pointer for precision.
 * - `mobile` variant: a larger translucent touch indicator sized like a
 *   fingertip so the viewer reads it as a finger, not a mouse.
 */
export async function injectCustomCursor(
  page: Page,
  variant: InputVariant = 'desktop'
): Promise<void> {
  await page.evaluate((v: InputVariant) => {
    if (document.getElementById('demo-cursor')) return;

    const isMobile = v === 'mobile';

    const style = document.createElement('style');
    style.id = 'demo-cursor-styles';
    const cursorSize = isMobile ? 40 : 22;
    const trailSize = isMobile ? 28 : 14;
    const bg = isMobile ? 'rgba(59, 130, 246, 0.55)' : '#3b82f6';
    const ringColor = isMobile ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.92)';
    const ringWidth = isMobile ? 3 : 2;
    const shadow = isMobile
      ? '0 0 28px rgba(59, 130, 246, 0.55), 0 4px 18px rgba(0, 0, 0, 0.3)'
      : '0 0 16px rgba(59, 130, 246, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35)';

    style.textContent = [
      '#demo-cursor {',
      `  position: fixed; width: ${cursorSize}px; height: ${cursorSize}px;`,
      '  border-radius: 50%;',
      `  background: ${bg};`,
      `  box-shadow: ${shadow}, inset 0 0 0 ${ringWidth}px ${ringColor};`,
      '  pointer-events: none; z-index: 999999;',
      '  transform: translate(-50%, -50%) scale(1);',
      '  transition: transform 0.12s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.12s ease;',
      `  opacity: ${isMobile ? '0.88' : '0.95'};`,
      '}',
      '#demo-cursor-trail {',
      `  position: fixed; width: ${trailSize}px; height: ${trailSize}px;`,
      '  border-radius: 50%;',
      `  background: ${isMobile ? 'rgba(59, 130, 246, 0.35)' : '#3b82f6'};`,
      '  pointer-events: none; z-index: 999998;',
      '  transform: translate(-50%, -50%); opacity: 0;',
      '  transition: opacity 0.3s ease, left 0.16s ease, top 0.16s ease;',
      '}',
    ].join('\n');
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    document.body.appendChild(cursor);

    const trail = document.createElement('div');
    trail.id = 'demo-cursor-trail';
    document.body.appendChild(trail);

    document.addEventListener('mousemove', (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      trail.style.left = `${e.clientX}px`;
      trail.style.top = `${e.clientY}px`;
      trail.style.opacity = isMobile ? '0.45' : '0.35';
      setTimeout(() => {
        trail.style.opacity = '0';
      }, 220);
    });

    document.addEventListener('mousedown', () => {
      cursor.style.transform = `translate(-50%, -50%) scale(${isMobile ? 0.85 : 0.7})`;
      cursor.style.boxShadow = isMobile
        ? `0 0 44px rgba(59, 130, 246, 0.8), 0 4px 22px rgba(0, 0, 0, 0.35), inset 0 0 0 3px rgba(255, 255, 255, 0.95)`
        : `0 0 24px rgba(59, 130, 246, 0.85), 0 2px 10px rgba(0, 0, 0, 0.4), inset 0 0 0 2px rgba(255, 255, 255, 1)`;
    });

    document.addEventListener('mouseup', () => {
      cursor.style.transform = 'translate(-50%, -50%) scale(1)';
      cursor.style.boxShadow = shadow + `, inset 0 0 0 ${ringWidth}px ${ringColor}`;
    });
  }, variant);
}

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a selector-based condition (used by waitFor in steps).
 */
async function waitForSelector(page: Page, waitFor: string): Promise<void> {
  if (waitFor.startsWith('url:')) {
    const urlFragment = waitFor.slice(4);
    await page.waitForURL(`**${urlFragment}**`, { timeout: 15_000 });
    return;
  }
  const locator = resolveSelector(page, waitFor);
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
}

/**
 * Wait for the page to visually settle after a navigation.
 */
async function settleAfterNavigate(page: Page): Promise<void> {
  // networkidle may not fire on some pages; ignore timeout
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Adaptive pacing
// ---------------------------------------------------------------------------

const PACING_MULTIPLIERS: Record<NonNullable<Pacing>, number> = {
  quick: 0.6,
  normal: 1.0,
  slow: 1.5,
  dramatic: 2.0,
};

const PACING_FLOORS: Record<NonNullable<Pacing>, number> = {
  quick: 900,
  normal: 1700,
  slow: 2200,
  dramatic: 3200,
};

const PACING_CAPS: Record<NonNullable<Pacing>, number> = {
  quick: 4000,
  normal: 8000,
  slow: 10000,
  dramatic: 12000,
};

/**
 * Minimum hold time per narrative beat. Beat floors are applied AFTER the
 * pacing floor, so a `quick` + `payoff` step still earns enough breathing
 * room to feel like a scene, not a transition.
 */
const BEAT_MIN_HOLD_MS: Record<NonNullable<Beat>, number> = {
  setup: 1200,
  action: 1800,
  payoff: 2800,
  close: 2200,
};

/** Reading speed (words per second). Tuned for demos, slower than subtitles. */
const WORDS_PER_SECOND = 3.2;

/**
 * Compute how long (ms) an annotation should stay visible, adapting to
 * content complexity, action type, pacing hint, narrative beat, and step
 * context. Short captions now get a higher effective reading speed so they
 * don't linger; beats enforce a floor so payoff moments land.
 */
export function computeAdaptiveHoldMs(text: string, step: Step, context: PacingContext): number {
  const pacing: NonNullable<Pacing> = ('pacing' in step ? step.pacing : undefined) ?? 'normal';
  const beat = stepBeat(step);

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  // Short captions read proportionally faster (viewer absorbs them at a glance).
  const effectiveWps = wordCount <= 6 ? WORDS_PER_SECOND + 0.6 : WORDS_PER_SECOND;
  const readingMs = (wordCount / effectiveWps) * 1000;

  let actionBonusMs = 0;
  switch (step.action) {
    case 'navigate':
      actionBonusMs = context.isFirstNavigation ? 2500 : 1200;
      if ('waitFor' in step && step.waitFor) actionBonusMs = Math.max(actionBonusMs, 2000);
      break;
    case 'click':
      actionBonusMs = 'waitFor' in step && step.waitFor ? 1200 : 600;
      break;
    case 'highlight':
      actionBonusMs = 800;
      break;
    case 'scroll':
      actionBonusMs = 600;
      break;
    case 'type':
      actionBonusMs = Math.ceil(('text' in step ? step.text.length : 0) / 10) * 200;
      break;
    default:
      break;
  }

  // Transition cushion: different action type than previous step
  const transitionMs = context.previousAction && context.previousAction !== step.action ? 300 : 0;

  const rawMs = readingMs + actionBonusMs + transitionMs;
  const multiplier = PACING_MULTIPLIERS[pacing];
  const pacingFloor = PACING_FLOORS[pacing];
  const beatFloor = beat ? BEAT_MIN_HOLD_MS[beat] : 0;
  const cap = PACING_CAPS[pacing];

  return Math.min(cap, Math.max(pacingFloor, beatFloor, Math.round(rawMs * multiplier)));
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

/**
 * Execute a single scenario step with adaptive pacing and professional overlays.
 */
export async function executeStep(
  page: Page,
  step: Step,
  outputDir: string,
  showAnnotations: boolean,
  pacingContext: PacingContext
): Promise<void> {
  const { stepIndex, totalSteps } = pacingContext;
  // The step's text is always known; `showAnnotations` only controls whether
  // we render it as a DOM overlay. Pacing holds still rely on the text's
  // length either way so the canvas caption has enough time to read.
  const annotation = 'annotation' in step ? step.annotation : undefined;
  const pacing: NonNullable<Pacing> = ('pacing' in step ? step.pacing : undefined) ?? 'normal';
  const beat = stepBeat(step);
  const emphasis = stepEmphasis(step);

  // DOM caption/chip rendering is disabled when the caller moves captions
  // to the Remotion canvas (parallel-record + caption-bar path).
  const renderDomOverlays = showAnnotations;

  // Beat transition chip: rendered in-DOM only when DOM overlays are on.
  // In the canvas-caption path, Remotion renders the chip over the videos.
  const beatChanged =
    beat !== undefined && beat !== pacingContext.previousBeat && step.action !== 'pause';
  if (renderDomOverlays && beatChanged && beat) {
    await showBeatChip(page, beat);
  }

  // Dramatic pre-action settle: build anticipation. The timing applies
  // regardless of caption rendering — it's a pacing concern.
  if (pacing === 'dramatic' && annotation) {
    if (renderDomOverlays && step.action !== 'navigate') {
      await setAnnotation(page, annotation, stepIndex, totalSteps, step.action, emphasis);
    }
    await page.waitForTimeout(800);
  } else if (renderDomOverlays && step.action !== 'navigate') {
    await setAnnotation(page, annotation, stepIndex, totalSteps, step.action, emphasis);
  }

  switch (step.action) {
    case 'navigate': {
      await page.goto(step.path, { waitUntil: 'domcontentloaded' });
      if (step.waitFor) await waitForSelector(page, step.waitFor);
      await settleAfterNavigate(page);
      if (renderDomOverlays) {
        await setAnnotation(page, annotation, stepIndex, totalSteps, step.action, emphasis);
      }
      break;
    }

    case 'click': {
      const locator = resolveSelector(page, step.selector);
      await showClickIndicator(page, locator, pacingContext.inputVariant ?? 'desktop');
      await locator.click();
      if (step.waitFor) await waitForSelector(page, step.waitFor);
      break;
    }

    case 'type': {
      const locator = resolveSelector(page, step.selector);
      await showClickIndicator(page, locator, pacingContext.inputVariant ?? 'desktop');
      await locator.click();
      const delay = step.typeDelay ?? 50;
      // Split on literal \n sequences so YAML "line\nline" produces actual Enter presses
      const segments = step.text.split('\\n');
      for (let i = 0; i < segments.length; i++) {
        if (segments[i]) {
          for (const char of segments[i]) {
            await page.keyboard.type(char, { delay });
          }
        }
        if (i < segments.length - 1) {
          await page.keyboard.press('Enter');
        }
      }
      break;
    }

    case 'scroll': {
      const totalDelta = step.direction === 'down' ? step.amount : -step.amount;
      const scrollSteps = 20;
      const perStep = totalDelta / scrollSteps;
      for (let s = 0; s < scrollSteps; s++) {
        await page.mouse.wheel(0, perStep);
        await page.waitForTimeout(16);
      }
      break;
    }

    case 'pause': {
      await page.waitForTimeout(step.duration);
      break;
    }

    case 'highlight': {
      const locator = resolveSelector(page, step.selector);
      await highlightElement(page, locator, step.duration ?? 2000);
      break;
    }

    case 'screenshot': {
      const name = step.name ?? `screenshot-${Date.now()}`;
      await page.screenshot({
        path: `${outputDir}/${name}.png`,
        fullPage: false,
      });
      break;
    }

    case 'pom': {
      // Consumers of this plugin can opt into the `pom` action by pointing
      // DEMO_POM_MODULE at their own Page Object Model barrel. Without it,
      // scenarios using `pom` fail fast with a clear error.
      const pomModulePath = process.env.DEMO_POM_MODULE;
      if (!pomModulePath) {
        throw new Error(
          'pom action requires DEMO_POM_MODULE env var to point at a POM barrel module'
        );
      }
      const pagesModule = (await import(pomModulePath)) as Record<string, unknown>;
      const PomClass = pagesModule[step.page] as new (p: Page) => Record<string, unknown>;
      if (!PomClass) {
        throw new Error(`Unknown POM class: ${step.page}`);
      }
      const pomInstance = new PomClass(page);
      const method = pomInstance[step.method];
      if (typeof method !== 'function') {
        throw new Error(`Unknown method: ${step.page}.${step.method}`);
      }
      const args = step.args ?? [];
      await (method as (...a: unknown[]) => Promise<void>).apply(pomInstance, args);
      break;
    }
  }

  // Auto-hold annotations so viewers can read the annotation.
  // Pause steps handle their own timing, so skip them.
  if (annotation && step.action !== 'pause') {
    await page.waitForTimeout(computeAdaptiveHoldMs(annotation, step, pacingContext));
  }
}
