# Demo Recorder Plugin

Record browser video demos of application features using pre-written Playwright scenarios.

## Available Commands

| Command | Description |
|---------|-------------|
| `/demo-record-pr [feature-description]` | Auto-generate a narrative-driven scenario from the branch diff and record it |
| `/demo-record [scenario-name]` | Record a video demo from a pre-written scenario file |
| `/demo-story [pr-number]` | Preview the story director's narrative arc without recording |
| `/demo-list` | List available demo scenarios |
| `/demo-scenarios` | Show detailed scenario information |
| `/demo-cleanup` | Clean up orphaned isolated environments (Docker containers, temp dirs) |

## How It Works

### One-command flow (recommended)

`/demo-record-pr` is the primary command. It reads the current branch's diff against `main`, identifies which pages and components changed, generates a scenario YAML that walks through the new feature, and records the video. One command: diff to video.

### Manual flow

1. Write a scenario YAML in `demo-recorder-plugin/scenarios/`.
2. Run `/demo-record <scenario-name>` to record it.

### Output

Videos are saved to `demo-recorder-plugin/output/` as `.mp4` files (H.264, CRF 16) when intro/outro sequences are enabled, or `.webm` files for raw recordings without sequences.

## Prerequisites

Before recording demos (when using the default local mode or `--isolated` mode):

1. **Web app must be running** at `http://localhost:3000` (or the URL set in `PLAYWRIGHT_BASE_URL`). Not required for `--preview` mode, which connects to a Vercel preview deployment instead.
2. **Auth state must exist.** The recorder reuses Playwright storage state from `./web/e2e/.auth/` by default. Override the location with `DEMO_AUTH_DIR=./my-auth-dir`. Generate state with your Playwright setup project.
3. **Playwright must be installed.** If browsers are missing:
   ```bash
   npx playwright install chromium
   ```

## Scenario Format

Each scenario YAML has:

- `name`: Unique identifier (matches filename without extension)
- `title`: Human-readable title
- `description`: What the demo shows
- `settings`: Auth profile, base URL, viewport dimensions
- `steps`: Ordered list of browser actions

### Step Actions

| Action | Parameters | Description |
|--------|-----------|-------------|
| `navigate` | `path`, `waitFor?`, `annotation?`, `pacing?` | Navigate to a URL path |
| `click` | `selector`, `waitFor?`, `annotation?`, `pacing?` | Click an element |
| `type` | `selector`, `text`, `typeDelay?`, `annotation?`, `pacing?` | Type text into an input |
| `scroll` | `direction`, `amount?`, `annotation?`, `pacing?` | Scroll the page (smooth incremental) |
| `pause` | `duration` | Wait N milliseconds (pacing) |
| `highlight` | `selector`, `duration?`, `annotation?`, `pacing?` | Highlight with pulsing glow + spotlight |
| `screenshot` | `name?` | Capture a still frame |
| `pom` | `page`, `method`, `args?`, `annotation?`, `pacing?` | Call a Page Object Model method directly |

Every action step (everything except `pause` and `screenshot`) additionally accepts:

| Field | Values | Description |
|-------|--------|-------------|
| `beat` | `setup`, `action`, `payoff`, `close` | Narrative beat. Drives beat-transition chips and minimum hold time. |
| `emphasis` | `normal` (default), `strong` | `strong` renders a larger title-card caption reserved for payoff moments. |
| `mobileSkip` | boolean | Skip this step on the mobile companion pass. |
| `mobileSelector` | string | Swap selector when recording the mobile pass (e.g., a different control). |
| `mobilePath` | string | Swap the `path` for `navigate` steps on the mobile pass. |

### Selector Syntax

Selectors use a prefix convention:

- `heading:Dashboard` resolves to `page.getByRole('heading', { name: 'Dashboard' })`
- `link:Clients` resolves to `page.getByRole('link', { name: 'Clients' })`
- `button:Save` resolves to `page.getByRole('button', { name: 'Save' })`
- `placeholder:Search` resolves to `page.getByPlaceholder('Search')`
- `testid:pipeline-chart` resolves to `page.getByTestId('pipeline-chart')`
- `text:Some text` resolves to `page.getByText('Some text')`
- Any other string is treated as a CSS selector: `page.locator(...)`

### Pacing

Steps with an `annotation` support an optional `pacing` field that controls how long the viewer has to absorb the step:

- `quick` (0.6x base): Setup/transition steps the audience doesn't need to study
- `normal` (default, 1.0x): Standard adaptive timing
- `slow` (1.5x): Complex screens, data-heavy views, extra breathing room
- `dramatic` (2.0x): "Money shot" moments with an 800ms pre-action settle for anticipation

Pacing is combined with content-aware timing that accounts for annotation word count, action type, first-navigation bonus, and scene-change transitions. The annotation hold also adapts to the reading speed (3.2 words/sec base, +0.6 for short captions).

### Narrative Beats

Tag each step with a `beat` field to shape the arc:

- `setup`: establishes the surface and the persona's situation.
- `action`: the interaction itself.
- `payoff`: the "money shot" where the change pays off. Typically combined with `pacing: dramatic` and `emphasis: strong`.
- `close`: the recap / takeaway. Usually `pacing: slow`.

When the beat changes between steps, the recorder shows a brief beat-transition chip (dim + label) so the viewer perceives a clean scene change. Beat floors also guarantee minimum hold times per beat (e.g., `payoff` holds at least 2800ms regardless of caption length).

### Story Director

`runner/story-director.ts` produces a narrative arc from the current branch or a specific PR. It picks a persona (agency PM / ops admin / exec / client), drafts setup + inciting moment + payoff, and maps UI test plan items to beats. Invoke it directly to preview the arc without recording:

```bash
npx tsx demo-recorder-plugin/runner/story-director.ts --pr 1971              # human-readable
npx tsx demo-recorder-plugin/runner/story-director.ts --pr 1971 --json       # machine-readable
npx tsx demo-recorder-plugin/runner/story-director.ts --pr 1971 --scaffold   # scenario skeleton YAML
```

The `/demo-record-pr` command calls this director first and uses the brief to drive scenario generation.

### Annotations

Steps with an `annotation` field display a floating glassmorphism pill at the bottom of the viewport during recording. The pill uses 18px/600 weight Inter with a dark 88%-opacity background and a subtle outer stroke so captions stay legible over any page background. It includes a step counter badge (`3/7`), an action icon, and a progress bar. Annotations crossfade between steps to avoid text flickering.

Set `emphasis: strong` on a step to render the caption as a larger title card with a brand accent strip, reserved for payoff moments.

### Highlights

The `highlight` action shows a pulsing blue glow ring around the target element with a dimmed spotlight overlay behind it. The glow animates between two intensities for a breathing effect.

### Custom Cursor

A branded cursor dot (12px blue circle) is automatically injected into every recording. It follows the mouse with a trailing effect and provides visual click feedback (scale down on press).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:3000` | Base URL of the running web app |
| `DEMO_OUTPUT_DIR` | `demo-recorder-plugin/output` | Directory for recorded videos |
| `DEMO_QUALITY` | (none) | Resolution preset: `720p`, `1080p`, `2k`, `4k`. Overrides YAML settings |
| `DEMO_ANNOTATIONS` | `true` | Set to `0` or `false` to hide annotation subtitles |
| `DEMO_SEQUENCES` | `true` | Set to `0` or `false` to skip Remotion intro/outro rendering |
| `DEMO_ISOLATED` | `0` | Set to `1` to spin up an isolated Supabase + Next.js stack per recording |
| `DEMO_PREVIEW` | `0` | Set to `1` to record against a Vercel preview deployment |
| `DEMO_MOBILE` | `0` | Set to `1` to record a parallel mobile companion and composite side-by-side |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | (none) | Bypass secret for Vercel deployment protection |
| `PREVIEW_SUPABASE_URL` | (none) | Supabase API URL for the branch database |
| `PREVIEW_SUPABASE_ANON_KEY` | (none) | Supabase anon key for the branch database |
| `GITHUB_TOKEN` | (none) | GitHub token for resolving preview URLs from PR numbers |

### Quality Presets

Use `settings.quality` in the scenario YAML or the `DEMO_QUALITY` env var:

| Preset | Resolution |
|--------|-----------|
| `720p` | 1280x720 |
| `1080p` | 1920x1080 (default) |
| `2k` | 2560x1440 |
| `4k` | 3840x2160 |

Example YAML:
```yaml
settings:
  quality: 4k
```

Or via env var:
```bash
DEMO_QUALITY=720p npx tsx demo-recorder-plugin/runner/record.ts scenario.yaml
```

The `quality` preset takes precedence over explicit `viewport` dimensions. The `DEMO_QUALITY` env var overrides the YAML setting.

### Intro/Outro Sequences

By default, recorded videos are wrapped with an animated intro and outro, rendered via Remotion with crossfade transitions (0.5s overlap) between sequences.

**Intro**: Animated gradient background with dot grid, optional category badge, title (Inter 64px with spring + scale), accent line with gradient, description, and optional sprint label. Fades out with upward parallax.

**Outro**: Structured layout with category badge, title, step/duration metadata, optional highlights card (glassmorphism), categorized step summary (grouped by Navigation/Interactions/Data Entry/Observation), and footer bar with date and org name.

**Adaptive timing**: Durations auto-compute from content length (3 words/sec reading speed) and scale proportionally to recording duration: shorter intros for quick demos (<30s: 0.8x), longer for comprehensive walkthroughs (>90s: 1.2x). Explicit overrides still available.

**Typography**: Inter (heading/body) and JetBrains Mono (monospace) via `@remotion/google-fonts`.

Configure in YAML:
```yaml
settings:
  sequences:
    enabled: true            # default: true
    introDurationSec: 8      # optional: override auto-computed duration
    outroDurationSec: 10     # optional: override auto-computed duration
    brandColor: '#3b82f6'    # default: blue-500
    category: "Feature Demo" # optional: badge in intro/outro
    sprintLabel: "Sprint 42" # optional: shown in intro
    orgName: "27 Street"     # optional: shown in outro footer
    highlights: ["Real-time pipeline visualization", "One-click client navigation"]  # optional: key takeaways in outro card
```

Disable via env var:
```bash
DEMO_SEQUENCES=0 npx tsx demo-recorder-plugin/runner/record.ts scenario.yaml
```

Both sequences automatically adapt to the recording resolution and content length. The encoding uses H.264 with CRF 16 for high visual fidelity.

## Mobile Companion Recording

The recorder can replay the same scenario at a phone viewport in a second pass and composite both streams into a single video. Enable via any of:

1. **CLI flag**: `--mobile`
2. **Environment variable**: `DEMO_MOBILE=1`
3. **Scenario YAML**:
   ```yaml
   settings:
     mobile:
       enabled: true
       viewport: { width: 390, height: 844 }  # iPhone 14 Pro (default)
       deviceScaleFactor: 3                   # default
       layout: side-by-side                   # default: side-by-side | pip | sequential
   ```

### Layouts

- **`side-by-side`** (default): desktop occupies the left 68% of a widened canvas; the phone sits in a stylized device frame on the right 32%. Final output resolution widens to `ceil(desktop_width * 4/3 / 2) * 2 x desktop_height` (e.g., 2560x1080 for a 1080p desktop).
- **`pip`**: desktop stays fullscreen; the phone renders as a bottom-right picture-in-picture.
- **`sequential`**: desktop plays for the first half, phone for the second half. No compositing.

### Per-step mobile overrides

Steps accept `mobileSkip: true` (skip on the mobile pass), `mobileSelector` (use a different selector on mobile, e.g., a hamburger menu), and `mobilePath` (navigate to a different route on mobile). This lets one scenario drive a faithful mobile replay even when the responsive layout diverges from desktop.

The mobile pass runs **sequentially after** the desktop pass (same browser, fresh context), not truly in parallel. This is intentional: sequential replay is more reliable when steps depend on network timing, at the cost of ~1.8x wall-clock time. The final Remotion render composites both `.webm` files into a single `.mp4`.

## Parallel / Isolated Recording

By default, demos connect to the shared dev server at `localhost:3000`. For parallel
recording, enable isolation to spin up a dedicated Supabase + Next.js stack per demo.

Three ways to enable isolation:

1. **CLI flag**: `--isolated`
2. **Environment variable**: `DEMO_ISOLATED=1`
3. **Scenario YAML**: `settings.isolated: true`

Each isolated instance gets dynamically allocated ports, its own Supabase containers,
its own database (with all migrations applied), and its own Next.js process. Cleanup
is automatic when the recording finishes or fails.

Example (two demos in parallel):
```bash
DEMO_ISOLATED=1 npx tsx demo-recorder-plugin/runner/record.ts scenarios/a.yaml &
DEMO_ISOLATED=1 npx tsx demo-recorder-plugin/runner/record.ts scenarios/b.yaml &
wait
```

**Resource requirements**: ~2-3 GB RAM and ~10 Docker containers per isolated instance.
Recommended maximum: 3 concurrent isolated recordings on a 16GB machine.

**How it works**: The env-manager allocates a block of consecutive free TCP ports starting
from 55000, creates a temporary Supabase project directory with rewritten `config.toml` and
symlinked migrations, starts Supabase, then starts Next.js with environment variables pointing
to the isolated Supabase. After recording, it stops all services and removes the temp directory.

**Orphan protection**: Each isolated environment is registered with a PID lock file. On startup,
the reaper scans for entries whose owning process has died and cleans them up automatically.
SIGINT/SIGTERM handlers ensure graceful shutdown of Docker containers on interrupt.

### Manual Cleanup

If resources leak (crashed recordings, Docker containers still running), use:

```bash
npx tsx demo-recorder-plugin/runner/cleanup.ts
```

Or via the Claude Code command: `/demo-cleanup`

This stops all `demo-*` Supabase projects and removes their temp directories.

## Preview Mode (Vercel Deployments)

Record demos against Vercel preview deployments instead of a local dev server. Each PR
already gets its own Vercel preview URL and Supabase branch database, providing full data
isolation without any local Docker overhead.

Three ways to enable preview mode:

1. **CLI flag**: `--preview --pr <number>` (resolves the preview URL from the PR)
2. **CLI flag**: `--preview --preview-url <url>` (uses a direct URL)
3. **Environment variable**: `DEMO_PREVIEW=1` (requires `--pr` or `--preview-url`)
4. **Scenario YAML**: `settings.preview: true` (requires `--pr` or `--preview-url`)

### Bypass Secret

Vercel deployment protection requires a bypass secret. The recorder resolves it in order:

1. `--bypass-secret <value>` CLI flag
2. `VERCEL_AUTOMATION_BYPASS_SECRET` environment variable
3. Interactive prompt (if running in a TTY)

In non-interactive contexts (CI), the secret must be provided via flag or env var.

### Examples

```bash
# Record against PR #1234's preview deployment
npx tsx demo-recorder-plugin/runner/record.ts \
  --preview --pr 1234 \
  --bypass-secret "$VERCEL_BYPASS_SECRET" \
  scenarios/my-demo.yaml

# Record against a direct preview URL
npx tsx demo-recorder-plugin/runner/record.ts \
  --preview --preview-url https://client-requirements-tool-xxx.vercel.app \
  scenarios/my-demo.yaml
```

### Branch Supabase Auth

To generate auth tokens against the branch Supabase instance, set:

- `PREVIEW_SUPABASE_URL`: The branch Supabase API URL
- `PREVIEW_SUPABASE_ANON_KEY`: The branch Supabase anon key

If these are not set, the recorder falls back to the local auth state from `web/e2e/.auth/`.

### Comparison with Isolated Mode

| | `--preview` | `--isolated` |
|---|---|---|
| Best for | CI, PR-based demos | Local dev, offline |
| Startup | Near-instant | ~60-90s |
| Docker required | No | Yes |
| Data isolation | Supabase branch DB | Local Supabase instance |
| Network | Remote (Vercel) | Local |

Preview and isolated modes are mutually exclusive.

## Running the Recorder

The recorder is invoked as:

```bash
npx tsx demo-recorder-plugin/runner/record.ts demo-recorder-plugin/scenarios/<name>.yaml
```

It prints the output video path to stdout on success.

## Writing Style

NEVER use em dashes in responses. Use commas, colons, semicolons, parentheses, or separate sentences instead.