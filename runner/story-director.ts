#!/usr/bin/env -S npx tsx

/**
 * Story Director.
 *
 * Turns a PR into a narrative arc (persona, setup, inciting moment, action
 * beats, payoff, close) and a scenario skeleton that the recording pipeline
 * can flesh out. The goal is to move demos from mechanical walkthroughs to
 * product stories that explain WHY a change matters, not just WHAT clicks
 * are performed.
 *
 * Usage:
 *   npx tsx demo-recorder-plugin/runner/story-director.ts [--pr <n>] [--json]
 *   npx tsx demo-recorder-plugin/runner/story-director.ts --scaffold > out.yaml
 *
 * Typical flow: the /demo-record-pr command runs this first to produce a
 * brief, then drives the scenario YAML generation from that brief so pacing,
 * beats, and annotations all trace back to a single narrative source.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Persona {
  name: string;
  role: string;
  /** One-line motivation that frames why this person uses the feature. */
  motivation: string;
}

export interface ActionBeat {
  /** Short beat title used for logging and chip labels. */
  title: string;
  /** Narrative purpose of this beat (used as annotation rationale). */
  rationale: string;
  /** UI surface the beat happens on (route, component). */
  surface: string;
  /** Narrative beat tag written into step `beat` fields. */
  beat: 'setup' | 'action' | 'payoff' | 'close';
  /** If true, the scenario should mark this step `emphasis: strong`. */
  emphasis?: boolean;
  /**
   * When 'data-creation', the scaffold expands this beat into a multi-step
   * create sequence (navigate → type fields → click submit) instead of a
   * single navigate. Otherwise the beat renders as a plain navigate.
   */
  sequence?: 'data-creation' | 'interaction';
  /** Create-flow descriptor. Required when `sequence` is 'data-creation'. */
  dataFlow?: DataFlow;
}

/**
 * A curated create-flow the director knows how to weave into the narrative
 * when the PR diff touches it. Populated from the DATA_FLOWS table below;
 * not inferred from the diff. Keeping the table hand-written makes the
 * output deterministic and unit-testable, and the set of flows small
 * enough to audit in one sitting.
 */
export interface DataFlow {
  /** Short verb phrase used in narration ("creates a new client"). */
  label: string;
  /** Route to navigate to for the create form. Placeholders allowed. */
  route: string;
  /**
   * Patterns matched against the PR's changedFiles and routes. When any
   * pattern matches, the flow is considered triggered by this PR.
   */
  triggerPatterns: RegExp[];
  /** Fields filled on the create form, in visual order. */
  fields: Array<{ selector: string; value: string; annotation?: string }>;
  /** Selector for the submit control. */
  submitSelector: string;
  /**
   * Optional route navigated to after submit so the viewer sees the new
   * record land on the observable surface. Placeholders allowed.
   */
  postCreateSurface?: string;
}

export interface NarrativeArc {
  persona: Persona;
  setup: string;
  incitingMoment: string;
  action: ActionBeat[];
  payoff: string;
  closing: string;
  /** Distilled takeaways for the outro highlights card (max 5). */
  highlights: string[];
}

export interface PRContext {
  prNumber?: number;
  title?: string;
  body?: string;
  testPlanItems: string[];
  changedFiles: string[];
  /** Route paths inferred from changed `web/src/app/.../page.tsx` files. */
  routes: string[];
  /** Primary area of the change: settings, dashboard, client detail, etc. */
  primaryArea: string;
  /** One of the seeded E2E clients, chosen to match the primary route. */
  seededClient: { id: string; name: string };
}

// ---------------------------------------------------------------------------
// Seeded clients (kept in sync with /demo-record-pr command doc)
// ---------------------------------------------------------------------------

const SEEDED_CLIENTS = {
  luxeBoutique: { id: 'c0000000-0000-4000-8000-000000000001', name: 'Luxe Boutique' },
  techGearPro: { id: 'c0000000-0000-4000-8000-000000000002', name: 'Tech Gear Pro' },
  greenGardens: { id: 'c0000000-0000-4000-8000-000000000003', name: 'Green Gardens' },
  nordicCrafts: { id: 'c0000000-0000-4000-8000-000000000004', name: 'Nordic Crafts' },
  alpineSports: { id: 'c0000000-0000-4000-8000-000000000005', name: 'Alpine Sports' },
} as const;

// ---------------------------------------------------------------------------
// Curated data-creation flows
// ---------------------------------------------------------------------------

/**
 * Hand-maintained table of create-flows the director can weave into the
 * narrative. Kept intentionally small so demos stay deterministic and the
 * set of flows is reviewable in one sitting. Add a new entry when a PR
 * repeatedly benefits from narrating data creation rather than relying on
 * seeded data.
 */
const DATA_FLOWS: Record<string, DataFlow> = {
  // Triggers are intentionally narrow (create-form paths or explicit
  // `*-edit-drawer`/`*-form` components) so they only fire when the PR is
  // meaningfully touching a create surface. Broadening them to match any
  // file under `partner-programs/` or `pipeline/` produced noisy results
  // when validated against real CRT PRs (#1964 misfired newOpportunity on
  // an unrelated API route change).
  newClient: {
    label: 'a new client',
    route: '/clients/new',
    triggerPatterns: [/web\/src\/app\/.*clients\/new\//, /client-(?:create|new)-form/],
    fields: [
      { selector: 'placeholder:Client name', value: 'Aurora Apparel' },
      { selector: 'placeholder:Contact email', value: 'hello@aurora-apparel.test' },
    ],
    submitSelector: 'button:Create client',
    postCreateSurface: '/clients',
  },
  newTask: {
    label: 'a new task',
    route: '/clients/<id>/scope',
    triggerPatterns: [/web\/src\/app\/.*tasks\/new\//, /task-(?:edit-drawer|create-form|new-form)/],
    fields: [{ selector: 'placeholder:Task title', value: 'Draft launch checklist' }],
    submitSelector: 'button:Add task',
    postCreateSurface: '/clients/<id>/scope',
  },
  newRunningCost: {
    label: 'a new running cost',
    route: '/clients/<id>/costs',
    triggerPatterns: [
      /web\/src\/app\/.*(?:running-)?costs?\/new\//,
      /(?:running-)?cost-(?:edit-drawer|create-form|new-form)/,
    ],
    fields: [
      { selector: 'placeholder:Cost name', value: 'Klaviyo' },
      { selector: 'placeholder:Monthly amount', value: '150' },
    ],
    submitSelector: 'button:Add running cost',
    postCreateSurface: '/clients/<id>/costs',
  },
  newPartnerProgram: {
    label: 'a new partner program',
    route: '/settings/partner-programs/new',
    triggerPatterns: [
      /web\/src\/app\/.*partner-programs?\/new\//,
      /partner-program-(?:edit-drawer|create-form|new-form)/,
    ],
    fields: [
      { selector: 'placeholder:Program name', value: 'Shopify Partners' },
      { selector: 'placeholder:Detection keywords', value: 'shopify, shop, shopify-plus' },
    ],
    submitSelector: 'button:Create program',
    postCreateSurface: '/settings/partner-programs',
  },
  newOpportunity: {
    label: 'a new opportunity',
    route: '/pipeline/new',
    triggerPatterns: [
      /web\/src\/app\/.*(?:pipeline|opportunit[a-z]*)\/new\//,
      /opportunity-(?:edit-drawer|create-form|new-form)/,
    ],
    fields: [
      { selector: 'placeholder:Opportunity name', value: 'Aurora retainer' },
      { selector: 'placeholder:Estimated value', value: '12500' },
    ],
    submitSelector: 'button:Create opportunity',
    postCreateSurface: '/pipeline',
  },
};

// ---------------------------------------------------------------------------
// Persona selection
// ---------------------------------------------------------------------------

const PERSONAS: Record<string, Persona> = {
  agencyPM: {
    name: 'Sarah',
    role: 'Agency Account Manager',
    motivation: 'juggles a dozen Shopify clients and needs the tool to surface what matters next',
  },
  opsAdmin: {
    name: 'Marcus',
    role: 'Operations Lead',
    motivation:
      'configures the system and keeps partner programs, running costs, and referrals clean',
  },
  execReader: {
    name: 'Priya',
    role: 'Agency Director',
    motivation:
      'scans dashboards before a leadership review and needs at-a-glance trustworthy data',
  },
  clientPortal: {
    name: 'Alex',
    role: 'Client Stakeholder',
    motivation: 'wants a straightforward view of project progress without agency jargon',
  },
};

/**
 * Choose a persona from the primary area of the PR. Rules favour the
 * person who would realistically use the changed surface most, not the
 * engineer who built it.
 */
function selectPersona(primaryArea: string): Persona {
  if (primaryArea.startsWith('settings') || primaryArea.startsWith('admin')) {
    return PERSONAS.opsAdmin;
  }
  if (primaryArea.startsWith('dashboard')) {
    return PERSONAS.execReader;
  }
  if (primaryArea.startsWith('portal')) {
    return PERSONAS.clientPortal;
  }
  return PERSONAS.agencyPM;
}

// ---------------------------------------------------------------------------
// Git + GitHub context gathering
// ---------------------------------------------------------------------------

/**
 * Invoke a command with a fixed argv. Never pass user input through a shell
 * string; `execFileSync` runs the binary directly, sidestepping injection.
 */
function safeExec(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function getBaseBranch(): string {
  const branches = safeExec('git', ['branch', '-r']).split('\n');
  if (branches.some((b) => b.includes('origin/main'))) return 'main';
  if (branches.some((b) => b.includes('origin/master'))) return 'master';
  return 'main';
}

function getChangedFiles(baseBranch: string): string[] {
  const output = safeExec('git', ['diff', `${baseBranch}...HEAD`, '--name-only']);
  return output ? output.split('\n').filter(Boolean) : [];
}

interface PRView {
  number?: number;
  title?: string;
  body?: string;
}

function getPRView(prNumber?: number): PRView {
  const args = ['pr', 'view'];
  if (prNumber !== undefined && Number.isFinite(prNumber)) {
    args.push(String(prNumber));
  }
  args.push('--json', 'number,title,body');
  const raw = safeExec('gh', args);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as PRView;
  } catch {
    return {};
  }
}

/**
 * Extract the `## Test plan` section from a PR body and return UI-adjacent
 * checklist items. Non-UI items (migrations, API contracts) are filtered so
 * the director doesn't try to film a database change.
 */
export function extractUITestPlanItems(body: string | undefined): string[] {
  if (!body) return [];

  const lines = body.split('\n');
  const startIdx = lines.findIndex((l) => /^##\s+Test plan\b/i.test(l));
  if (startIdx === -1) return [];

  const endIdx = lines.findIndex((l, i) => i > startIdx && /^##\s+/.test(l));
  const section = lines.slice(startIdx + 1, endIdx === -1 ? undefined : endIdx);

  const items = section
    .map((l) => l.match(/^\s*-\s*\[[ xX]\]\s*(.+?)\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);

  // UI keyword filter: keeps items that reference visible or interactive UI.
  const uiPattern =
    /\b(page|route|button|modal|tab|form|badge|card|dialog|panel|table|chart|banner|toast|link|menu|drawer|sheet|toggle|checkbox|input|field|header|section|list|view|display|show|render|navigate|click|toggle|open|close|select|scroll|submit|type|hover|screenshot)\b/i;
  return items.filter((item) => uiPattern.test(item));
}

// ---------------------------------------------------------------------------
// Route and area inference
// ---------------------------------------------------------------------------

/**
 * Map a Next.js App Router page path to a URL. Dynamic segments become
 * placeholder tokens so the caller knows where to plug a seeded ID.
 */
function appFileToRoute(file: string): string | undefined {
  const prefix = 'web/src/app/';
  if (!file.startsWith(prefix) || !file.endsWith('/page.tsx')) return undefined;

  const middle = file.slice(prefix.length, -'/page.tsx'.length);
  // Strip route groups like `(dashboard)` and replace dynamic segments with placeholders.
  const segments = middle
    .split('/')
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => (s.startsWith('[') && s.endsWith(']') ? `<${s.slice(1, -1)}>` : s));

  return '/' + segments.join('/');
}

function inferRoutes(changedFiles: string[]): string[] {
  const routes = new Set<string>();
  for (const file of changedFiles) {
    const route = appFileToRoute(file);
    if (route) routes.add(route);
  }
  return Array.from(routes);
}

/**
 * Identify the primary area. Uses the most common route prefix, falling
 * back to a heuristic when no app pages changed (e.g., component-only PRs).
 */
function inferPrimaryArea(routes: string[], changedFiles: string[]): string {
  if (routes.length > 0) {
    const firstSegment = routes[0].replace(/^\//, '').split('/')[0] || 'general';
    return firstSegment;
  }
  if (changedFiles.some((f) => f.startsWith('web/src/components/dashboard'))) return 'dashboard';
  if (changedFiles.some((f) => f.startsWith('web/src/components/settings'))) return 'settings';
  if (changedFiles.some((f) => f.startsWith('web/src/components/portal'))) return 'portal';
  if (changedFiles.some((f) => f.startsWith('web/src/components/clients'))) return 'clients';
  return 'general';
}

function selectSeededClient(primaryArea: string): { id: string; name: string } {
  if (primaryArea === 'clients') return SEEDED_CLIENTS.techGearPro;
  if (primaryArea === 'portal') return SEEDED_CLIENTS.luxeBoutique;
  return SEEDED_CLIENTS.luxeBoutique;
}

// ---------------------------------------------------------------------------
// Backend-only detection and data-as-story planning
// ---------------------------------------------------------------------------

function isFrontendFile(file: string): boolean {
  // `web/src/app/api/` is server-only (API route handlers); don't count it
  // as frontend or a PR touching only API handlers would be misclassified.
  if (file.startsWith('web/src/app/api/')) return false;
  return (
    file.startsWith('web/src/components/') ||
    file.startsWith('web/src/app/') ||
    file.startsWith('web/src/hooks/')
  );
}

/**
 * Returns true when the PR touches no routes and no frontend files, so the
 * scenario needs a synthetic "manifestation surface" to demo against.
 */
export function isBackendOnly(context: PRContext): boolean {
  if (context.routes.length > 0) return false;
  return !context.changedFiles.some(isFrontendFile);
}

/**
 * Pick a user-facing surface where a backend-only change becomes visible.
 * Ordered rules; first match wins. Falls back to the dashboard so the arc
 * always has something to film.
 */
export function manifestationSurface(context: PRContext): string {
  const files = context.changedFiles;
  if (files.some((f) => /partner/i.test(f))) return '/clients/<id>/financials';
  if (files.some((f) => /running[_-]?cost/i.test(f))) return '/clients/<id>/financials';
  if (files.some((f) => /opportunit/i.test(f) || /pipeline/i.test(f))) return '/pipeline';
  if (files.some((f) => /commission/i.test(f))) return '/dashboard';
  if (files.some((f) => /task/i.test(f))) return '/clients/<id>/scope';
  return '/dashboard';
}

/**
 * Inspect the PR context against the curated DATA_FLOWS table and produce
 * at most one data-creation beat. Capped at one so recordings stay short.
 */
export function planDataBeats(context: PRContext, persona: Persona): ActionBeat[] {
  const haystack = [...context.changedFiles, ...context.routes];
  for (const flow of Object.values(DATA_FLOWS)) {
    const match = flow.triggerPatterns.some((pattern) =>
      haystack.some((candidate) => pattern.test(candidate))
    );
    if (!match) continue;
    return [
      {
        title: `Create ${flow.label}`,
        rationale: `${persona.name} creates ${flow.label} so the demo runs on real data, not stubs.`,
        surface: flow.route,
        beat: 'action',
        sequence: 'data-creation',
        dataFlow: flow,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Annotation voice rewriting
// ---------------------------------------------------------------------------

function truncateToSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0];
  return firstSentence.length <= max ? firstSentence : `${text.slice(0, max - 3)}...`;
}

/**
 * Rewrite a raw rationale (often a verbatim test-plan item) in persona
 * voice with cause/effect framing. Deterministic and template-based by
 * design so the output is unit-testable and drift-free.
 */
export function rewriteRationale(
  raw: string,
  persona: Persona,
  beat: 'setup' | 'action' | 'payoff' | 'close'
): string {
  const text = raw.trim();
  if (!text) return text;

  // "after X, Y" reads as cause-and-effect; surface the cause explicitly.
  const afterMatch = text.match(/^after\s+(.+?),\s+(.+)$/i);
  if (afterMatch) {
    return truncateToSentence(`Because ${afterMatch[1]}, ${afterMatch[2]}`, 140);
  }

  const stripped = text.replace(/^(navigate to|click (?:the |on )?|open|tap|select|press)\s+/i, '');
  const didStrip = stripped !== text;
  const body = didStrip ? stripped.charAt(0).toLowerCase() + stripped.slice(1) : stripped;
  const lower = body.charAt(0).toLowerCase() + body.slice(1);

  let result: string;
  switch (beat) {
    case 'setup':
      result = didStrip ? `${persona.name} opens ${body}` : `${persona.name} sees ${lower}`;
      break;
    case 'payoff':
      result = `Now ${persona.name} sees ${lower}`;
      break;
    case 'close':
      result = `${persona.name} leaves knowing ${lower}`;
      break;
    default:
      result = didStrip ? `${persona.name} ${body}` : body;
      break;
  }
  return truncateToSentence(result, 140);
}

// ---------------------------------------------------------------------------
// Narrative synthesis
// ---------------------------------------------------------------------------

/**
 * Build action beats from the UI test plan items. Each test plan item is
 * read as one act in the story. When there are too few items, synthesize
 * beats from route transitions instead so the arc always has at least a
 * setup, action, and payoff.
 */
function beatsFromTestPlan(items: string[], routes: string[], persona: Persona): ActionBeat[] {
  if (items.length === 0) {
    return beatsFromRoutes(routes, persona);
  }

  const beats: ActionBeat[] = [];
  const count = Math.min(items.length, 5);

  for (let i = 0; i < count; i++) {
    const item = items[i];
    let beat: ActionBeat['beat'];
    if (i === 0) beat = 'setup';
    else if (i === count - 1) beat = 'payoff';
    else beat = 'action';

    beats.push({
      title: item.length > 60 ? `${item.slice(0, 57)}...` : item,
      rationale: rewriteRationale(item, persona, beat),
      surface: routes[0] ?? '/dashboard',
      beat,
      emphasis: beat === 'payoff',
    });
  }

  beats.push({
    title: 'Recap the value',
    rationale: rewriteRationale(
      'Return to the surface that proves the change delivered what the PR promised.',
      persona,
      'close'
    ),
    surface: routes[0] ?? '/dashboard',
    beat: 'close',
  });

  return beats;
}

function beatsFromRoutes(routes: string[], persona: Persona): ActionBeat[] {
  const primary = routes[0] ?? '/dashboard';
  const rewrite = (raw: string, beat: 'setup' | 'action' | 'payoff' | 'close') =>
    rewriteRationale(raw, persona, beat);
  return [
    {
      title: 'Arrive at the affected surface',
      rationale: rewrite(
        'Establish the page in its current state so the change is visible by contrast.',
        'setup'
      ),
      surface: primary,
      beat: 'setup',
    },
    {
      title: 'Trigger the changed behavior',
      rationale: rewrite('Interact with the new or modified UI element.', 'action'),
      surface: primary,
      beat: 'action',
    },
    {
      title: 'Show the result',
      rationale: rewrite('Highlight the post-change state.', 'payoff'),
      surface: primary,
      beat: 'payoff',
      emphasis: true,
    },
    {
      title: 'Recap the value',
      rationale: rewrite('Zoom out to the takeaway.', 'close'),
      surface: primary,
      beat: 'close',
    },
  ];
}

function articleFor(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function synthesizeArc(context: PRContext): NarrativeArc {
  const persona = selectPersona(context.primaryArea);

  // Backend-only PRs have no routes to demo against; pick a synthetic
  // surface that shows where the change manifests so the scaffold still
  // lands on a real page instead of producing an empty navigate.
  const effectiveRoutes =
    context.routes.length === 0 && isBackendOnly(context)
      ? [manifestationSurface(context)]
      : context.routes;

  const action = beatsFromTestPlan(context.testPlanItems, effectiveRoutes, persona);

  // Splice a data-creation beat in after the setup beat (position 1) when
  // the diff matches one of the curated create flows. Capped at one beat.
  const dataBeats = planDataBeats(context, persona);
  if (dataBeats.length > 0) {
    const insertAt = action.length > 0 && action[0].beat === 'setup' ? 1 : 0;
    action.splice(insertAt, 0, ...dataBeats);
  }

  const featureTitle = context.title ?? 'this change';
  const roleLower = persona.role.toLowerCase();

  const setup =
    `${persona.name} is ${articleFor(roleLower)} ${roleLower} who ${persona.motivation}.` +
    ` Today they're working with ${context.seededClient.name}.`;

  const incitingMoment =
    context.testPlanItems[0] ??
    `${persona.name} needs to confirm "${featureTitle}" behaves correctly on ${context.routes[0] ?? 'the affected screen'}.`;

  const payoffBeat = action.find((b) => b.beat === 'payoff');
  const payoff =
    payoffBeat?.rationale ??
    `The change makes ${featureTitle} obvious at a glance, so ${persona.name} can move on without second-guessing.`;

  const closing = `Before, this meant a separate check or manual workaround. Now ${persona.name} sees it inline, where they already work.`;

  const highlights = [
    ...context.testPlanItems.slice(0, 3),
    ...(context.testPlanItems.length < 3
      ? action.slice(0, 3 - context.testPlanItems.length).map((b) => b.title)
      : []),
  ].slice(0, 5);

  return { persona, setup, incitingMoment, action, payoff, closing, highlights };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a PR context object from the current branch. Callers can override
 * `prNumber` to inspect a specific PR instead of the current one.
 */
export function buildPRContext(prNumber?: number): PRContext {
  const baseBranch = getBaseBranch();
  const view = getPRView(prNumber);
  const changedFiles = getChangedFiles(baseBranch);
  const testPlanItems = extractUITestPlanItems(view.body);
  const routes = inferRoutes(changedFiles);
  const primaryArea = inferPrimaryArea(routes, changedFiles);
  const seededClient = selectSeededClient(primaryArea);

  return {
    prNumber: view.number ?? prNumber,
    title: view.title,
    body: view.body,
    testPlanItems,
    changedFiles,
    routes,
    primaryArea,
    seededClient,
  };
}

/**
 * Produce a narrative arc from PR context. This is the "direction" step:
 * persona, setup, inciting moment, action beats, payoff, close.
 */
export function directNarrative(context: PRContext): NarrativeArc {
  return synthesizeArc(context);
}

/** Produce a printable summary of the narrative arc for human review. */
export function formatArcForHuman(arc: NarrativeArc, context: PRContext): string {
  const lines: string[] = [];
  lines.push('STORY DIRECTOR BRIEF');
  lines.push('='.repeat(60));
  if (context.prNumber) lines.push(`PR: #${context.prNumber} ${context.title ?? ''}`);
  lines.push(`Primary area: ${context.primaryArea}`);
  lines.push(`Seeded client: ${context.seededClient.name} (${context.seededClient.id})`);
  lines.push('');
  lines.push(`PERSONA: ${arc.persona.name}, ${arc.persona.role}`);
  lines.push(`  ${arc.persona.motivation}`);
  lines.push('');
  lines.push('SETUP');
  lines.push(`  ${arc.setup}`);
  lines.push('');
  lines.push('INCITING MOMENT');
  lines.push(`  ${arc.incitingMoment}`);
  lines.push('');
  lines.push('ACTION BEATS');
  for (const beat of arc.action) {
    const emphasisTag = beat.emphasis ? ' [emphasis: strong]' : '';
    lines.push(`  - (${beat.beat}) ${beat.title}${emphasisTag}`);
    lines.push(`      ${beat.rationale}`);
    lines.push(`      surface: ${beat.surface}`);
  }
  lines.push('');
  lines.push('PAYOFF');
  lines.push(`  ${arc.payoff}`);
  lines.push('');
  lines.push('CLOSING');
  lines.push(`  ${arc.closing}`);
  lines.push('');
  if (arc.highlights.length > 0) {
    lines.push('HIGHLIGHTS (outro card)');
    for (const h of arc.highlights) lines.push(`  - ${h}`);
  }
  return lines.join('\n');
}

/**
 * Emit a skeleton scenario YAML from the arc. Each action beat becomes a
 * placeholder step with the right beat/emphasis tags; the human or Claude
 * Code fleshes out the selectors, types, and scrolls.
 */
export function scaffoldScenarioYaml(arc: NarrativeArc, context: PRContext): string {
  const scenarioName = context.prNumber ? `pr-${context.prNumber}-demo` : 'demo-scenario';
  const title = context.title ?? 'Feature Demo';
  // Substitute route-placeholder tokens (`<id>`, `<clientId>`, ...) with the
  // seeded client id everywhere in the output — narrative text, step paths,
  // and annotations — so a scaffold YAML is ready to run without manual
  // editing of placeholder tokens.
  const fillPlaceholders = (s: string): string =>
    s.replace(/<[a-zA-Z][a-zA-Z0-9_-]*>/g, context.seededClient.id);

  // YAML accepts JSON-style double-quoted scalars, so JSON.stringify gives
  // us a correctly-escaped string for free: backslashes, quotes, newlines,
  // and control characters are all handled. Hand-rolled `.replace(/"/g,…)`
  // missed backslashes, which CodeQL flagged as incomplete string escaping.
  const yamlString = (s: string): string => JSON.stringify(fillPlaceholders(s));

  const description = `${arc.persona.name}'s story: ${arc.payoff}`;

  const lines: string[] = [];
  lines.push(`name: ${scenarioName}`);
  lines.push(`title: ${yamlString(title)}`);
  lines.push(`description: ${yamlString(description)}`);
  lines.push('');
  lines.push('narrative:');
  lines.push(`  persona: ${yamlString(`${arc.persona.name}, ${arc.persona.role}`)}`);
  lines.push(`  setup: ${yamlString(arc.setup)}`);
  lines.push(`  incitingMoment: ${yamlString(arc.incitingMoment)}`);
  lines.push(`  payoff: ${yamlString(arc.payoff)}`);
  lines.push(`  closing: ${yamlString(arc.closing)}`);
  lines.push('');
  lines.push('settings:');
  lines.push('  isolated: true');
  lines.push('  auth: ownerUser');
  lines.push('  sequences:');
  lines.push('    category: "PR Demo"');
  if (arc.highlights.length > 0) {
    const entries = arc.highlights.map(yamlString).join(', ');
    lines.push(`    highlights: [${entries}]`);
  }
  lines.push('');
  lines.push('steps:');

  for (const beat of arc.action) {
    lines.push(`  # ${beat.beat.toUpperCase()}: ${beat.title}`);

    if (beat.sequence === 'data-creation' && beat.dataFlow) {
      // Expand the create flow into navigate → type (per field) → click.
      // Each step carries the same beat tag so transition chips don't flicker.
      const flow = beat.dataFlow;
      lines.push('  - action: navigate');
      lines.push(`    path: ${fillPlaceholders(flow.route)}`);
      lines.push(`    beat: ${beat.beat}`);
      lines.push(`    annotation: ${yamlString(beat.rationale)}`);
      lines.push('    pacing: quick');
      lines.push('');

      for (const field of flow.fields) {
        lines.push('  - action: type');
        lines.push(`    selector: ${yamlString(field.selector)}`);
        lines.push(`    text: ${yamlString(field.value)}`);
        lines.push(`    beat: ${beat.beat}`);
        if (field.annotation) {
          lines.push(`    annotation: ${yamlString(field.annotation)}`);
        }
        lines.push('    pacing: normal');
        lines.push('');
      }

      lines.push('  - action: click');
      lines.push(`    selector: ${yamlString(flow.submitSelector)}`);
      lines.push(`    beat: ${beat.beat}`);
      lines.push('    pacing: normal');
      lines.push('');

      if (flow.postCreateSurface) {
        lines.push('  - action: navigate');
        lines.push(`    path: ${fillPlaceholders(flow.postCreateSurface)}`);
        lines.push(`    beat: ${beat.beat}`);
        lines.push('    pacing: slow');
        lines.push('');
      }
      continue;
    }

    lines.push('  - action: navigate');
    lines.push(`    path: ${fillPlaceholders(beat.surface)}`);
    lines.push(`    beat: ${beat.beat}`);
    if (beat.emphasis) lines.push('    emphasis: strong');
    lines.push(`    annotation: ${yamlString(beat.rationale)}`);
    lines.push(
      `    pacing: ${beat.beat === 'payoff' ? 'dramatic' : beat.beat === 'setup' ? 'slow' : 'normal'}`
    );
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  prNumber?: number;
  json: boolean;
  scaffold: boolean;
  out?: string;
}

function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = { json: false, scaffold: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--pr') {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) result.prNumber = n;
    } else if (arg === '--json') {
      result.json = true;
    } else if (arg === '--scaffold') {
      result.scaffold = true;
    } else if (arg === '--out') {
      result.out = argv[++i];
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const context = buildPRContext(args.prNumber);
  const arc = directNarrative(context);

  if (args.scaffold) {
    const yaml = scaffoldScenarioYaml(arc, context);
    if (args.out) {
      const outPath = path.resolve(args.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, yaml);
      console.error(`Scenario scaffold written to ${outPath}`);
    } else {
      process.stdout.write(yaml);
    }
    return;
  }

  if (args.json) {
    const payload = { context, arc };
    process.stdout.write(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(formatArcForHuman(arc, context));
}

// Run CLI when invoked directly.
const invokedUrl = import.meta.url;
const invokedPath = invokedUrl.startsWith('file://') ? new URL(invokedUrl).pathname : invokedUrl;
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(invokedPath)) {
  main().catch((err) => {
    console.error('Story director failed:', err);
    process.exit(1);
  });
}
