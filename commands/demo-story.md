---
description: "Preview the story director's narrative arc for a PR without recording."
argument-hint: "[pr-number]"
---

# /demo-story

Show the narrative arc the story director would use for a PR: persona, setup, inciting moment, action beats, payoff, and closing. Nothing is recorded; this is the sanity check before running `/demo-record-pr`.

## Workflow

1. **Resolve the PR number:**
   - If the user supplied a positional argument (`/demo-story 1971`), use it verbatim.
   - Otherwise, run `gh pr view --json number -q .number` to resolve the current branch's PR.
   - If no PR exists on the current branch, fall back to the diff against `main`. Tell the user that the brief is branch-derived rather than PR-derived.

2. **Run the director in human-readable mode:**
   ```bash
   npx tsx demo-recorder-plugin/runner/story-director.ts --pr <n>
   ```
   For branch-only runs, omit `--pr`.

3. **Print the brief verbatim** so the user sees the persona, beats, payoff, and highlights exactly as the recorder would.

4. **Offer the scaffold (optional):** if the user wants to turn this into a starting point scenario, suggest:
   ```bash
   npx tsx demo-recorder-plugin/runner/story-director.ts --pr <n> --scaffold --out demo-recorder-plugin/scenarios/pr-<n>-demo.yaml
   ```
   Remind them that the scaffold has placeholder navigate steps; the clicks, types, scrolls, and highlights still need to be written by hand (or by running `/demo-record-pr`, which fleshes out the scaffold using the diff).

## Optional JSON mode

If the user asks for the raw brief (e.g., to pipe into another tool):

```bash
npx tsx demo-recorder-plugin/runner/story-director.ts --pr <n> --json
```

## Error Handling

| Error | Resolution |
|-------|------------|
| `gh` not installed or not authenticated | Tell the user to install and auth `gh` via `gh auth login` |
| No PR for the current branch | Run without `--pr` and report the branch-derived brief |
| Empty test plan | The director falls back to route-derived beats; flag this and suggest writing a `## Test plan` section on the PR for a richer arc |

## Example

User runs: `/demo-story 1971`

Claude will:
1. Execute `npx tsx demo-recorder-plugin/runner/story-director.ts --pr 1971`.
2. Print the brief: persona (e.g., "Sarah, Agency Account Manager"), setup, beats, payoff, highlights.
3. Offer the `--scaffold --out` command if the user wants to bootstrap a scenario file.
