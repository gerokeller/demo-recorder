import { describe, expect, it } from 'vitest';
import type { PRContext } from '../story-director.ts';
import {
  directNarrative,
  extractUITestPlanItems,
  formatArcForHuman,
  scaffoldScenarioYaml,
} from '../story-director.ts';

describe('extractUITestPlanItems', () => {
  it('returns an empty list when the body is missing', () => {
    expect(extractUITestPlanItems(undefined)).toEqual([]);
    expect(extractUITestPlanItems('')).toEqual([]);
  });

  it('returns an empty list when no Test plan section exists', () => {
    const body = '## Summary\n\nSomething happened.\n';
    expect(extractUITestPlanItems(body)).toEqual([]);
  });

  it('extracts UI checklist items and drops non-UI ones', () => {
    const body = [
      '## Test plan',
      '- [ ] Navigate to the new widget page',
      '- [ ] API returns 200',
      '- [ ] Button opens the modal',
      '- [x] Migration runs without errors',
      '',
      '## Risks',
      '- [ ] Nothing',
    ].join('\n');

    const items = extractUITestPlanItems(body);
    expect(items).toContain('Navigate to the new widget page');
    expect(items).toContain('Button opens the modal');
    expect(items).not.toContain('API returns 200');
    expect(items).not.toContain('Migration runs without errors');
  });

  it('stops at the next H2 heading', () => {
    const body = [
      '## Test plan',
      '- [ ] Navigate to /clients',
      '',
      '## Rollout',
      '- [ ] Deploy button clicked',
    ].join('\n');

    const items = extractUITestPlanItems(body);
    expect(items).toEqual(['Navigate to /clients']);
  });
});

function makeContext(overrides: Partial<PRContext> = {}): PRContext {
  return {
    prNumber: 1234,
    title: 'Add widget',
    body: undefined,
    testPlanItems: [],
    changedFiles: [],
    routes: ['/dashboard'],
    primaryArea: 'dashboard',
    seededClient: { id: 'c-id', name: 'Demo Client' },
    ...overrides,
  };
}

describe('directNarrative', () => {
  it('picks the ops persona for settings-area PRs', () => {
    const arc = directNarrative(makeContext({ primaryArea: 'settings' }));
    expect(arc.persona.name).toBe('Marcus');
    expect(arc.persona.role).toBe('Operations Lead');
  });

  it('picks the exec persona for dashboard-area PRs', () => {
    const arc = directNarrative(makeContext({ primaryArea: 'dashboard' }));
    expect(arc.persona.name).toBe('Priya');
  });

  it('picks the portal persona for portal-area PRs', () => {
    const arc = directNarrative(makeContext({ primaryArea: 'portal' }));
    expect(arc.persona.name).toBe('Alex');
  });

  it('defaults to the agency PM persona', () => {
    const arc = directNarrative(makeContext({ primaryArea: 'clients' }));
    expect(arc.persona.name).toBe('Sarah');
  });

  it('uses test plan items as action beats when present', () => {
    const arc = directNarrative(
      makeContext({
        testPlanItems: ['Dashboard shows the widget', 'Modal opens on click'],
      })
    );
    const titles = arc.action.map((b) => b.title);
    expect(titles).toContain('Dashboard shows the widget');
    expect(titles).toContain('Modal opens on click');
    // The arc always appends a closing beat.
    expect(arc.action[arc.action.length - 1].beat).toBe('close');
  });

  it('synthesizes a fallback arc when no test plan items exist', () => {
    const arc = directNarrative(makeContext());
    const beats = arc.action.map((b) => b.beat);
    expect(beats).toContain('setup');
    expect(beats).toContain('action');
    expect(beats).toContain('payoff');
    expect(beats).toContain('close');
  });

  it('marks exactly one beat as emphasis=true when test plan drives the arc', () => {
    const arc = directNarrative(
      makeContext({ testPlanItems: ['Setup shown', 'Action happens', 'Result displayed'] })
    );
    const emphasisCount = arc.action.filter((b) => b.emphasis).length;
    expect(emphasisCount).toBe(1);
  });

  it('keeps highlights capped at 5 entries', () => {
    const arc = directNarrative(
      makeContext({
        testPlanItems: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'],
      })
    );
    expect(arc.highlights.length).toBeLessThanOrEqual(5);
  });
});

describe('formatArcForHuman', () => {
  it('includes persona, beats, payoff, and highlights in the printable summary', () => {
    const context = makeContext({ testPlanItems: ['A', 'B', 'C'] });
    const arc = directNarrative(context);
    const formatted = formatArcForHuman(arc, context);

    expect(formatted).toContain('PERSONA');
    expect(formatted).toContain(arc.persona.name);
    expect(formatted).toContain('ACTION BEATS');
    expect(formatted).toContain('PAYOFF');
    expect(formatted).toContain('HIGHLIGHTS');
  });
});

describe('scaffoldScenarioYaml', () => {
  it('emits a parseable YAML skeleton with the PR number in the name', () => {
    const context = makeContext({ prNumber: 9999 });
    const arc = directNarrative(context);
    const yaml = scaffoldScenarioYaml(arc, context);

    expect(yaml).toMatch(/^name: pr-9999-demo/);
    expect(yaml).toContain('narrative:');
    expect(yaml).toContain('steps:');
    // Flow arrays (single-line) are used for highlights so our minimal YAML
    // parser can consume the scaffold.
    expect(yaml).toMatch(/highlights: \[/);
  });

  it('substitutes dynamic path placeholders with the seeded client id', () => {
    const context = makeContext({
      routes: ['/clients/<id>/financials'],
      seededClient: { id: 'abc-123', name: 'Demo Client' },
    });
    const arc = directNarrative(context);
    const yaml = scaffoldScenarioYaml(arc, context);
    expect(yaml).toContain('/clients/abc-123/financials');
    expect(yaml).not.toContain('<id>');
  });
});
