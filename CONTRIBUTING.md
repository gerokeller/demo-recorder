# Contributing to demo-recorder

Thanks for your interest. This is a small, focused tool and the maintainer bar is:

1. The code stays easy to read.
2. New features earn their complexity.
3. Every change keeps setup painless for new users.

## Quickstart

```bash
git clone https://github.com/gerokeller/demo-recorder.git
cd demo-recorder
npm install
npx playwright install chromium
npx tsx runner/doctor.ts   # verify your environment
```

## The checks

Before opening a PR, run:

```bash
npm run check
```

This runs `typecheck`, `lint`, and `test` in sequence. CI re-runs the same plus:

- Format check (`npm run format:check`)
- Coverage report with 70% thresholds (`npm run test:coverage`)
- `npm audit --audit-level=high`
- CodeQL analysis
- Dependency Review

## Architecture

```
runner/
├── record.ts                # CLI entrypoint
├── story-director.ts        # Narrative arc synthesis from PR context
├── step-executor.ts         # Per-step Playwright driver + cursor/click visuals
├── scenario-schema.ts       # Zod schemas for scenario YAML
├── yaml-parser.ts           # Minimal YAML parser (tested)
├── render-sequences.ts      # Remotion bundle + render orchestration
├── tts.ts                   # Voice-over pipeline (Piper → Google → OpenAI → say)
├── env-manager.ts           # Isolated Supabase + Next.js stack
├── preview-env.ts           # Vercel preview deployment mode
├── auth-profiles.ts         # Auth credentials (overridable via DEMO_AUTH_PROFILES)
├── doctor.ts                # Diagnostic checks
├── cleanup.ts               # Orphan cleanup
├── helpers/network.ts       # Route stubs (customizable via DEMO_STUB_ROUTES_MODULE)
└── remotion/                # Remotion composition + components
```

## Adding a scenario action

1. Add the action to the Zod discriminated union in `runner/scenario-schema.ts`.
2. Handle the action in the `switch` in `runner/step-executor.ts`.
3. Add a unit test covering the schema case in `runner/__tests__/scenario-schema.test.ts`.
4. Document the action in `README.md` under the Scenario Actions table.

## Adding a TTS provider

1. Add a `generate*` function to `runner/tts.ts` that writes an MP3 at the given path.
2. Add a detection branch to `detectProvider()` (keep the priority deterministic).
3. Add a dispatch case inside `generateVoiceOver()`.
4. Document the setup in `README.md` under Voice-over.

## Extending the story director

- Persona selection is in `selectPersona()`. Keep it rule-based (code, not a model).
- Beat synthesis is in `beatsFromTestPlan()` / `beatsFromRoutes()`. One beat per scenario act.
- Add tests in `runner/__tests__/story-director.test.ts` for every new branch.

## Coding conventions

- **No default exports.** Named exports only.
- **Biome** for lint + format. Run `npm run lint:fix` and `npm run format`.
- **Strict TypeScript** (`noEmit`, runs via `tsx`). No `any`.
- **Comments explain WHY, not WHAT.** A comment that just narrates the code is noise.
- **Trust internal code.** Only validate at system boundaries (user input, external APIs).
- **Keep dependencies lean.** PRs that add deps should explain why a standard-library alternative doesn't work.

## Commit messages

Conventional commits. Examples:

- `feat(tts): add ElevenLabs provider`
- `fix(story): drop trailing period from beat title`
- `chore(deps): bump remotion to 4.0.500`
- `docs: clarify auth profile override`

## Releasing (maintainers only)

1. Update `CHANGELOG.md` with the next version's changes.
2. Bump `package.json` version.
3. Tag: `git tag v0.2.0 && git push --tags`.
4. GitHub Release is drafted automatically from tag (future work; manual for now).
