import { describe, expect, it } from 'vitest';
import { scenarioSchema, stepSchema } from '../scenario-schema.ts';

describe('scenarioSchema', () => {
  it('accepts a minimal valid scenario', () => {
    const result = scenarioSchema.safeParse({
      name: 'demo',
      title: 'Demo',
      description: 'A demo',
      steps: [{ action: 'navigate', path: '/' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a scenario with no steps', () => {
    const result = scenarioSchema.safeParse({
      name: 'demo',
      title: 'Demo',
      description: 'A demo',
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a scenario name containing a path separator', () => {
    const result = scenarioSchema.safeParse({
      name: 'nested/demo',
      title: 'Demo',
      description: 'A demo',
      steps: [{ action: 'navigate', path: '/' }],
    });
    expect(result.success).toBe(false);
  });

  it('applies default pacing + emphasis values to steps', () => {
    const result = scenarioSchema.safeParse({
      name: 'demo',
      title: 'Demo',
      description: 'A demo',
      steps: [{ action: 'navigate', path: '/', annotation: 'Hello' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const first = result.data.steps[0];
      if (first.action === 'navigate') {
        expect(first.pacing).toBe('normal');
        expect(first.emphasis).toBe('normal');
      }
    }
  });

  it('applies default sequence settings', () => {
    const result = scenarioSchema.safeParse({
      name: 'demo',
      title: 'Demo',
      description: 'A demo',
      steps: [{ action: 'navigate', path: '/' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.settings.sequences.enabled).toBe(true);
      expect(result.data.settings.sequences.brandColor).toBe('#3b82f6');
    }
  });

  it('defaults mobile settings to disabled', () => {
    const result = scenarioSchema.safeParse({
      name: 'demo',
      title: 'Demo',
      description: 'A demo',
      steps: [{ action: 'navigate', path: '/' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.settings.mobile.enabled).toBe(false);
      expect(result.data.settings.mobile.layout).toBe('side-by-side');
    }
  });

  it('accepts a full story-director scenario with narrative + beats', () => {
    const result = scenarioSchema.safeParse({
      name: 'demo',
      title: 'Demo',
      description: 'A demo',
      narrative: {
        persona: 'Sarah',
        setup: 'Setup text',
        payoff: 'Payoff text',
      },
      settings: {
        mobile: { enabled: true, layout: 'pip' },
      },
      steps: [
        {
          action: 'navigate',
          path: '/',
          beat: 'setup',
          emphasis: 'normal',
          annotation: 'Hi',
          pacing: 'slow',
        },
        {
          action: 'highlight',
          selector: 'heading:Dashboard',
          beat: 'payoff',
          emphasis: 'strong',
          pacing: 'dramatic',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.settings.mobile.layout).toBe('pip');
      expect(result.data.narrative?.persona).toBe('Sarah');
    }
  });
});

describe('stepSchema', () => {
  it('rejects navigate steps with a non-leading-slash path', () => {
    const result = stepSchema.safeParse({ action: 'navigate', path: 'dashboard' });
    expect(result.success).toBe(false);
  });

  it('accepts mobileSkip on click steps', () => {
    const result = stepSchema.safeParse({
      action: 'click',
      selector: 'button:Save',
      mobileSkip: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a screenshot name with a path separator', () => {
    const result = stepSchema.safeParse({ action: 'screenshot', name: 'nested/foo' });
    expect(result.success).toBe(false);
  });

  it('accepts scroll steps with defaults', () => {
    const result = stepSchema.safeParse({ action: 'scroll', direction: 'down' });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === 'scroll') {
      expect(result.data.amount).toBe(300);
    }
  });
});
