# demo-recorder

[![CI](https://github.com/gerokeller/demo-recorder/actions/workflows/ci.yml/badge.svg)](https://github.com/gerokeller/demo-recorder/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-22%2B-brightgreen)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/Playwright-45ba4b?logo=playwright&logoColor=white)](https://playwright.dev)
[![Remotion](https://img.shields.io/badge/Remotion-4.0-purple)](https://remotion.dev)

Record narrative-driven browser video demos from YAML scenarios. Parallel desktop + mobile capture, beat-synced on-canvas captions, text-to-speech voice-over, and a Remotion-rendered intro/outro.

Designed for product teams who want demos that tell a story rather than mechanical click-throughs.

## Features

- **Parallel capture** — desktop and mobile record the same scenario at the same time; step boundaries are shared by construction.
- **Side-by-side composition** — widened 2344x1260 canvas; desktop on the left, stylized phone frame on the right.
- **Narrative beats** — tag steps `setup | action | payoff | close`; the composition shows beat-transition chips and adapts pacing.
- **On-canvas captions** — a single shared caption strip below both views; no overlay chrome bleeds into the recording.
- **Voice-over** — auto-detects Piper (local neural) → Google Cloud TTS (OAuth) → OpenAI TTS (API key) → macOS `say`.
- **Intro/outro** — Remotion-rendered title card + step summary with adaptive durations.
- **Story Director** — generates a narrative arc (persona, setup, inciting moment, payoff, close) from a PR's diff + test plan.
- **Isolated mode** — spins up a dedicated Supabase + Next.js stack per recording for parallel, deterministic runs.
- **Preview mode** — record against any Vercel preview deployment.

## Installation

```bash
git clone https://github.com/gerokeller/demo-recorder.git
cd demo-recorder
npm install
npx playwright install chromium
```

## Quick start

Write a scenario in `scenarios/my-demo.yaml`:

```yaml
name: my-demo
title: "Quick Tour"
description: "A 45-second walkthrough of the feature."

settings:
  auth: ownerUser
  sequences:
    category: "Feature Demo"
    highlights: ["Stat 1", "Stat 2", "Stat 3"]
  mobile:
    enabled: true
    layout: side-by-side

steps:
  - action: navigate
    path: /dashboard
    waitFor: "heading:Dashboard"
    beat: setup
    annotation: "Monday morning. The user opens the dashboard."
    pacing: slow

  - action: highlight
    selector: "heading:Dashboard"
    beat: payoff
    emphasis: strong
    pacing: dramatic
    annotation: "Everything they need at a glance."
```

Record it:

```bash
DEMO_AUTH_DIR=./e2e/.auth npx tsx runner/record.ts scenarios/my-demo.yaml
```

Output lands in `output/*.mp4`.

## Scenario actions

| Action | Purpose |
|---|---|
| `navigate` | Open a URL path |
| `click` | Click a selector |
| `type` | Type text into an input |
| `scroll` | Smooth scroll |
| `pause` | Hold for N ms |
| `highlight` | Pulsing glow ring on an element |
| `screenshot` | Capture a still frame |
| `pom` | Call a Page Object Model method (requires `DEMO_POM_MODULE`) |

Every action step accepts `annotation`, `pacing`, `beat`, `emphasis`, `mobileSkip`, `mobileSelector`, `mobilePath`.

## Selectors

Selectors use a prefix convention:

- `heading:Dashboard` → `page.getByRole('heading', { name: 'Dashboard' })`
- `link:Clients` → `page.getByRole('link', { name: 'Clients' })`
- `button:Save` → `page.getByRole('button', { name: 'Save' })`
- `placeholder:Search` → `page.getByPlaceholder('Search')`
- `testid:pipeline-chart` → `page.getByTestId('pipeline-chart')`
- `text:Some text` → `page.getByText('Some text')`
- Any other string is a CSS selector

## Voice-over

Voice-over is on by default; disable with `DEMO_VOICEOVER=0`.

Provider priority (first available wins):

1. **Piper** — install [piper](https://github.com/rhasspy/piper), drop an `.onnx` voice model in `~/.cache/piper/voices/` (or set `PIPER_MODEL=/path/to/voice.onnx`).
2. **Google Cloud TTS** — run `gcloud auth application-default login` once.
3. **OpenAI TTS** — set `OPENAI_API_KEY`.
4. **macOS `say`** — zero setup; robotic but always available on macOS.

## Modes

- **Local** (default): connect to a dev server at `http://localhost:3000` (or `PLAYWRIGHT_BASE_URL`).
- **Isolated** (`--isolated`): spin up Supabase + Next.js in Docker per recording. Needs Docker running and your app's `web/` directory; override location with `DEMO_WEB_DIR`.
- **Preview** (`--preview --pr <n>`): record against a Vercel preview deployment. Needs `VERCEL_AUTOMATION_BYPASS_SECRET`.

## Authentication

Playwright storage state files live at `./web/e2e/.auth/<profile>.json` by default. Override with:

```bash
DEMO_AUTH_DIR=./my-auth-dir npx tsx runner/record.ts scenarios/my-demo.yaml
```

## Mobile companion

Enable via `settings.mobile.enabled: true` in the scenario, the `--mobile` CLI flag, or `DEMO_MOBILE=1`. Layouts:

- `side-by-side` (default): desktop 80% + phone 20%, widened canvas.
- `pip`: desktop fullscreen, phone as picture-in-picture bottom-right.
- `sequential`: desktop first, then mobile.

Per-step overrides:
- `mobileSkip: true` — skip this step on mobile.
- `mobileSelector: "..."` — use a different selector on mobile (e.g., a hamburger menu).
- `mobilePath: "/..."` — navigate to a different route on mobile.

## Story Director

The story director turns a PR's diff + test plan into a narrative arc (persona, setup, inciting moment, action beats, payoff, close) and a scenario skeleton. Preview without recording:

```bash
npx tsx runner/story-director.ts --pr 1234
npx tsx runner/story-director.ts --pr 1234 --json
npx tsx runner/story-director.ts --pr 1234 --scaffold --out scenarios/pr-1234-demo.yaml
```

## POM integration (optional)

Scenarios can drive pre-existing Playwright Page Object Models via the `pom` action. Point `DEMO_POM_MODULE` at your POM barrel:

```bash
DEMO_POM_MODULE=./e2e/pages/index.ts npx tsx runner/record.ts scenarios/my-demo.yaml
```

Without it, scenarios using `pom` fail fast with a clear error.

## Custom route stubs

By default the plugin only stubs `/manifest.json`. If your app has chatty background requests that should be silenced during recording, write your own module and point `DEMO_STUB_ROUTES_MODULE` at it:

```ts
// my-stubs.ts
import type { Page } from 'playwright';
export async function stubBackgroundRoutes(page: Page): Promise<void> {
  await page.route('**/api/notifications/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' })
  );
}
```

```bash
DEMO_STUB_ROUTES_MODULE=./my-stubs.ts npx tsx runner/record.ts scenarios/my-demo.yaml
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:3000` | Base URL for local mode |
| `DEMO_OUTPUT_DIR` | `./output` | Output directory |
| `DEMO_AUTH_DIR` | `./web/e2e/.auth` | Storage state directory |
| `DEMO_POM_MODULE` | — | Path to POM barrel (for `pom` action) |
| `DEMO_STUB_ROUTES_MODULE` | — | Path to custom route stub module |
| `DEMO_WEB_DIR` | `./web` | Path to consumer web app (isolated mode) |
| `DEMO_VOICEOVER` | `1` | `0` to disable voice-over |
| `DEMO_ISOLATED` | `0` | `1` to use isolated mode |
| `DEMO_PREVIEW` | `0` | `1` to use preview mode |
| `DEMO_MOBILE` | `0` | `1` to record mobile companion |
| `DEMO_QUALITY` | — | `720p \| 1080p \| 2k \| 4k` |
| `DEMO_ANNOTATIONS` | `1` | `0` to disable DOM captions (auto-off when mobile enabled) |
| `DEMO_SEQUENCES` | `1` | `0` to skip intro/outro |
| `PIPER_MODEL` | — | Path to Piper voice `.onnx` model |
| `OPENAI_API_KEY` | — | API key for OpenAI TTS |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | — | Bypass secret for Vercel preview mode |

## Claude Code slash commands

This repo ships with Claude Code slash commands in `commands/`:

- `/demo-record` — record a pre-written scenario
- `/demo-record-pr` — auto-generate + record from the current PR
- `/demo-story` — preview the narrative arc without recording
- `/demo-list`, `/demo-scenarios`, `/demo-cleanup`

Register the plugin via your Claude Code plugin marketplace or drop the `.claude-plugin/` directory into your project.

## License

MIT. See [LICENSE](./LICENSE).

## Credits

Uses [Playwright](https://playwright.dev) for browser automation and [Remotion](https://remotion.dev) for compositing intro/outro and audio tracks.
