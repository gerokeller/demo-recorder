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
// Narrative synthesis
// ---------------------------------------------------------------------------

/**
 * Build action beats from the UI test plan items. Each test plan item is
 * read as one act in the story. When there are too few items, synthesize
 * beats from route transitions instead so the arc always has at least a
 * setup, action, and payoff.
 */
function beatsFromTestPlan(items: string[], routes: string[]): ActionBeat[] {
  if (items.length === 0) {
    return beatsFromRoutes(routes);
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
      rationale: item,
      surface: routes[0] ?? '/dashboard',
      beat,
      emphasis: beat === 'payoff',
    });
  }

  beats.push({
    title: 'Recap the value',
    rationale: 'Return to the surface that proves the change delivered what the PR promised.',
    surface: routes[0] ?? '/dashboard',
    beat: 'close',
  });

  return beats;
}

function beatsFromRoutes(routes: string[]): ActionBeat[] {
  const primary = routes[0] ?? '/dashboard';
  return [
    {
      title: 'Arrive at the affected surface',
      rationale: 'Establish the page in its current state so the change is visible by contrast.',
      surface: primary,
      beat: 'setup',
    },
    {
      title: 'Trigger the changed behavior',
      rationale: 'Interact with the new or modified UI element.',
      surface: primary,
      beat: 'action',
    },
    {
      title: 'Show the result',
      rationale: 'Highlight the post-change state.',
      surface: primary,
      beat: 'payoff',
      emphasis: true,
    },
    {
      title: 'Recap the value',
      rationale: 'Zoom out to the takeaway.',
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
  const action = beatsFromTestPlan(context.testPlanItems, context.routes);

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
  const description = `${arc.persona.name}'s story: ${arc.payoff}`;

  const lines: string[] = [];
  lines.push(`name: ${scenarioName}`);
  lines.push(`title: "${title.replace(/"/g, '\\"')}"`);
  lines.push(`description: "${description.replace(/"/g, '\\"')}"`);
  lines.push('');
  lines.push('narrative:');
  lines.push(`  persona: "${arc.persona.name}, ${arc.persona.role}"`);
  lines.push(`  setup: "${arc.setup.replace(/"/g, '\\"')}"`);
  lines.push(`  incitingMoment: "${arc.incitingMoment.replace(/"/g, '\\"')}"`);
  lines.push(`  payoff: "${arc.payoff.replace(/"/g, '\\"')}"`);
  lines.push(`  closing: "${arc.closing.replace(/"/g, '\\"')}"`);
  lines.push('');
  lines.push('settings:');
  lines.push('  isolated: true');
  lines.push('  auth: ownerUser');
  lines.push('  sequences:');
  lines.push('    category: "PR Demo"');
  lines.push('    orgName: "27 Street"');
  if (arc.highlights.length > 0) {
    const entries = arc.highlights.map((h) => `"${h.replace(/"/g, '\\"')}"`).join(', ');
    lines.push(`    highlights: [${entries}]`);
  }
  lines.push('');
  lines.push('steps:');

  for (const beat of arc.action) {
    lines.push(`  # ${beat.beat.toUpperCase()}: ${beat.title}`);
    const surfacePath = beat.surface.replace(/<id>/g, context.seededClient.id);
    lines.push('  - action: navigate');
    lines.push(`    path: ${surfacePath}`);
    lines.push(`    beat: ${beat.beat}`);
    if (beat.emphasis) lines.push('    emphasis: strong');
    lines.push(`    annotation: "${beat.rationale.replace(/"/g, '\\"')}"`);
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
