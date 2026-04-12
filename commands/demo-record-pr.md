---
description: "Auto-generate a demo scenario from the current branch diff and record it."
argument-hint: "[feature-description]"
---

# /demo-record-pr

Generate a **narrative-driven** demo scenario from the current branch's changes, then record a browser video. One command: diff to video.

Every PR demo recording runs in **isolated mode** by default, is **driven by the story director** (narrative arc, beats, payoff), and uses the **PR test plan** to flesh out the action beats.

## Workflow

1. **Run the story director** to build the narrative brief:
   ```bash
   npx tsx demo-recorder-plugin/runner/story-director.ts --json
   ```
   The JSON output contains `context` (PR number, title, test plan items, routes, seeded client) and `arc` (persona, setup, inciting moment, action beats, payoff, closing, highlights). Use this as the **single source of truth** for the scenario: it picks the persona, decides which steps are setup/action/payoff/close, and writes the highlights that go into the outro.

2. **Identify the base branch:** Default to `main`. If the user provides a specific base, use that.

3. **Use the brief's test plan items as action beats:**
   - The director already filters test plan items to UI-adjacent ones. Use them as-is.
   - Each item becomes a section of 8-10 steps. The director assigns `beat: setup`, `beat: action`, or `beat: payoff` in order, with the final section marked `emphasis: strong` for the payoff.
   - If the director returns no test plan items, it falls back to route-derived beats. Acknowledge to the user that the arc is thinner and suggest writing a richer `## Test plan` section.

4. **Gather the diff context:**
   - Run `git diff main...HEAD --name-only` to get changed files.
   - Focus on files under `web/src/app/`, `web/src/components/`, and `web/src/lib/` as these define the UI.
   - Read the changed page and component files to understand what the feature does.
   - If no UI files were changed AND no UI test plan items were found (step 3), tell the user this PR has no UI changes to demo and suggest writing a manual scenario instead. Stop here.

5. **Map changes to routes:** Use the Next.js App Router convention to determine which URL paths are affected:
   - `web/src/app/(dashboard)/clients/[id]/page.tsx` maps to `/clients/<id>`
   - `web/src/app/(dashboard)/dashboard/page.tsx` maps to `/dashboard`
   - Components under a route group indicate which page to demo.
   - If changes span multiple pages, pick the primary page (the one with the most changes).

6. **Identify a seeded client for navigation:** The E2E test suite seeds these clients:
   - Luxe Boutique: `c0000000-0000-4000-8000-000000000001`
   - Tech Gear Pro: `c0000000-0000-4000-8000-000000000002`
   - Green Gardens: `c0000000-0000-4000-8000-000000000003`
   - Nordic Crafts: `c0000000-0000-4000-8000-000000000004`
   - Alpine Sports: `c0000000-0000-4000-8000-000000000005`

   Use Luxe Boutique as the default for client detail demos.

7. **Generate a scenario YAML file** shaped by the narrative arc. Create the scenario at `demo-recorder-plugin/scenarios/<feature-name>.yaml`:

   **Option A (quick start):** generate a scaffold from the director, then fill in the selectors/clicks/scrolls:
   ```bash
   npx tsx demo-recorder-plugin/runner/story-director.ts --scaffold --out demo-recorder-plugin/scenarios/<feature-name>.yaml
   ```

   **Option B (full authoring):** write the YAML yourself, using the arc as the structure:

   **Always sets these settings:**
   - `settings.isolated: true` (all PR demos run in isolation)
   - `auth: ownerUser` unless the feature is role-specific.
   - `settings.sequences.highlights` pulled verbatim from `arc.highlights`.
   - `narrative` block populated from `arc.persona`, `arc.setup`, `arc.incitingMoment`, `arc.payoff`, `arc.closing` so viewers and future maintainers see the intent.

   **Shape the steps around beats, not raw UI actions:**
   - The first section (setup beat) establishes the surface: navigate, wait, optionally scroll, with annotations that frame *who* the user is and *why* they're here (not "this is the Financials page").
   - Middle sections (action beats) drive the interaction. Annotations must explain cause-and-effect ("Because the client uses Klaviyo, the system detected a partner match") rather than narrate clicks.
   - The final non-close section is the **payoff beat**: mark its primary step `emphasis: strong` and `pacing: dramatic`, then a second `highlight` step on the key element. The annotation here should contrast before/after.
   - The close beat recaps value. Use `pacing: slow` and a `highlight` of the outcome.

   **Data-as-story beats:** if the diff touches a known create flow (new client, new task, new running cost, new partner program, new opportunity), the director inserts a `sequence: data-creation` beat right after the setup. The scaffold expands this into a navigate → type-per-field → click-submit sequence so the demo *creates* the record on-camera instead of relying on seeds. Keep those steps or replace the selectors/values with ones you read out of the changed component — the curated flow list lives in `DATA_FLOWS` inside `runner/story-director.ts`. Add a new entry there if a future PR would benefit from narrating a different create flow.

   **Backend-only PRs:** when the diff has no routes and no frontend files, the director picks a "manifestation surface" (e.g., partner-detection changes → `/clients/<id>/financials`) so the arc lands on a real page. Use the suggested surface; if it's wrong for the PR, override the first step's `path` and note why in the annotation.

   **Every step should have:**
   - A `beat` field (`setup | action | payoff | close`) so the recorder can render beat-transition chips.
   - An `annotation` that explains *why* the viewer should care, written in third person about the persona.
   - A `pacing` field: `quick` for transitional setup, `normal` for action, `dramatic` for payoff, `slow` for close.

   **Per-step guidelines:**
   - Read the actual component JSX to find real element text, roles, test IDs, and placeholders. Do NOT guess selectors.
   - Use the selector prefix syntax documented in the plugin CLAUDE.md.
   - If the feature includes a form, show filling it out with realistic demo data.
   - If the feature includes a state change (toggle, transition, modal), capture before and after.
   - Cap the scenario at ~35 steps total (keeping under ~90 seconds including intro/outro).

   **Mobile companion (optional):** If the feature has a distinct mobile surface worth showing, add `settings.mobile.enabled: true`. The recorder will record a parallel mobile pass and composite it side-by-side in the final render. Mark desktop-only steps with `mobileSkip: true`.

   **Different auth profiles:** If a test plan item requires a different auth profile (e.g., "verify limited-access user cannot see admin panel"), generate a separate scenario YAML with a different `settings.auth` value and record it independently. Report both video paths.

8. **Check prerequisites:**
   - Verify Playwright is installed: check for `node_modules/playwright`. If missing, tell the user to run `npx playwright install chromium`.
   - Check auth state exists: look for `web/e2e/.auth/ownerUser.json`. If missing, tell the user to run `cd web && npx playwright test --project=setup`.
   - Note: in isolated mode, the dev server is started automatically. No need to check `localhost:3000`.

9. **Record the demo:**
   ```bash
   npx tsx demo-recorder-plugin/runner/record.ts --isolated demo-recorder-plugin/scenarios/<feature-name>.yaml
   ```
   Add `--mobile` if `settings.mobile.enabled` is set (or to override for a one-off run):
   ```bash
   npx tsx demo-recorder-plugin/runner/record.ts --isolated --mobile demo-recorder-plugin/scenarios/<feature-name>.yaml
   ```

10. **Report results:** Show:
    - The generated scenario file path (so the user can review or tweak it).
    - The output video path and file size.
    - A suggestion to attach the video to the PR.
    - If multiple scenarios were recorded (different auth profiles), list all video paths.

## Optional Argument

If the user provides a feature description (e.g., `/demo-record-pr inline editing on client detail`), use it to guide the scenario narrative and naming. If no argument is given, infer the feature from the test plan or diff.

## Example

User runs: `/demo-record-pr task priority badges`

Claude will:
1. Run `gh pr view --json body` and find a test plan with:
   - `- [ ] Priority badges display on scope tab`
   - `- [ ] Badge color matches priority level`
   - `- [ ] API returns correct priority data` (filtered out: not UI)
2. Run `git diff main...HEAD --name-only` and find changes in `web/src/app/(dashboard)/clients/[id]/scope/page.tsx` and `web/src/components/tasks/task-priority-badge.tsx`.
3. Read those files to find real selectors.
4. Generate `demo-recorder-plugin/scenarios/task-priority-badges.yaml` with `settings.isolated: true`, two sections (one per UI test item), and `settings.sequences.highlights` summarizing the key behaviors.
5. Run the recorder with `--isolated` and report the video path.

## Error Handling

| Error | Resolution |
|-------|------------|
| No UI changes detected in diff and no UI test plan items | Tell user this PR has no UI to demo; suggest writing a manual scenario |
| No PR found (not on a PR branch) | Fall back to diff-only analysis against `main`; skip test plan extraction |
| Cannot determine affected route | Ask the user which page to demo |
| Selector not found during recording | Show the failing step; suggest the user tweak the generated scenario and re-run with `/demo-record` |
| Auth state missing | Run `cd web && npx playwright test --project=setup` |
| Isolated environment fails to start | Check Docker is running; suggest `/demo-cleanup` for orphaned resources |
