import { describe, expect, it } from 'vitest';
import type { Step } from '../scenario-schema.ts';
import { computeAdaptiveHoldMs, type PacingContext } from '../step-executor.ts';

const baseContext: PacingContext = {
  stepIndex: 2,
  totalSteps: 9,
  isFirstNavigation: false,
  previousAction: 'click',
  previousBeat: 'action',
};

function clickStep(overrides: Partial<Step> = {}): Step {
  return {
    action: 'click',
    selector: 'button:Go',
    pacing: 'normal',
    emphasis: 'normal',
    mobileSkip: false,
    ...overrides,
  } as Step;
}

function navStep(overrides: Partial<Step> = {}): Step {
  return {
    action: 'navigate',
    path: '/dashboard',
    pacing: 'normal',
    emphasis: 'normal',
    mobileSkip: false,
    ...overrides,
  } as Step;
}

describe('computeAdaptiveHoldMs', () => {
  it('honors the pacing floor for a short quick caption', () => {
    const ms = computeAdaptiveHoldMs('Hi', clickStep({ pacing: 'quick' }), baseContext);
    expect(ms).toBeGreaterThanOrEqual(900);
  });

  it('honors the pacing floor for a short dramatic caption', () => {
    const ms = computeAdaptiveHoldMs('Hi', clickStep({ pacing: 'dramatic' }), baseContext);
    // Dramatic floor (3200) AND payoff beat floor (2800) both apply; max wins.
    expect(ms).toBeGreaterThanOrEqual(3200);
  });

  it('applies the per-beat floor even with quick pacing', () => {
    const ms = computeAdaptiveHoldMs('Tiny', clickStep({ pacing: 'quick', beat: 'payoff' }), {
      ...baseContext,
      previousBeat: 'action',
    });
    // payoff beat floor is 2800ms; quick pacing floor is 900ms.
    expect(ms).toBeGreaterThanOrEqual(2800);
  });

  it('never exceeds the dramatic pacing cap', () => {
    const long = 'one two three four five six seven eight nine ten '.repeat(20);
    const ms = computeAdaptiveHoldMs(long, clickStep({ pacing: 'dramatic' }), baseContext);
    expect(ms).toBeLessThanOrEqual(12_000);
  });

  it('gives first-navigation steps a larger hold than later navigations', () => {
    const caption = 'Arrive at the dashboard';
    const first = computeAdaptiveHoldMs(caption, navStep(), {
      ...baseContext,
      isFirstNavigation: true,
      previousAction: undefined,
      previousBeat: undefined,
    });
    const later = computeAdaptiveHoldMs(caption, navStep(), {
      ...baseContext,
      isFirstNavigation: false,
    });
    expect(first).toBeGreaterThan(later);
  });

  it('scales the hold with caption length', () => {
    const short = computeAdaptiveHoldMs('Short.', clickStep(), baseContext);
    const long = computeAdaptiveHoldMs(
      'This caption has many more words so the hold should grow accordingly.',
      clickStep(),
      baseContext
    );
    expect(long).toBeGreaterThan(short);
  });

  it('adds a transition cushion when the previous action differs', () => {
    const same = computeAdaptiveHoldMs('Same action type again', clickStep(), {
      ...baseContext,
      previousAction: 'click',
    });
    const switched = computeAdaptiveHoldMs('Same action type again', clickStep(), {
      ...baseContext,
      previousAction: 'scroll',
    });
    expect(switched).toBeGreaterThanOrEqual(same);
  });
});
