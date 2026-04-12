# Changelog

All notable changes to this project will be documented here. This project
follows [Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

## [Unreleased]

### Added

- Unit test suite covering `scenario-schema`, `yaml-parser`, `story-director`,
  `step-executor` pacing math, and the TTS module surface (51 tests).
- `runner/doctor.ts` diagnostic script that checks Node, Playwright, ffmpeg,
  Docker, auth state, TTS provider, and `gh` — with actionable remediations.
- GitHub Actions workflows for CI (typecheck + lint + format + tests + audit
  on Ubuntu and macOS), CodeQL (`security-extended`, weekly + PR), and
  Dependency Review (blocks high-severity intros).
- `SECURITY.md` with private vulnerability reporting instructions and
  `CONTRIBUTING.md` with architecture, conventions, and PR checklist.
- Extracted minimal YAML parser into `runner/yaml-parser.ts` for testability.

### Changed

- `scaffoldScenarioYaml` now substitutes route placeholders (`<id>`, etc.)
  throughout the emitted narrative and step blocks, not just step paths.

## [0.1.0] - 2026-04-12

### Added

- Initial release of demo-recorder.
- Parallel desktop + mobile capture via `Promise.all` — shared step
  boundaries by construction, no per-beat canvas remapping needed.
- Side-by-side composition on a 2344x1260 Remotion canvas with a stylized
  phone frame; `pip` and `sequential` layouts also supported.
- On-canvas caption bar with beat chips, step counter, action icon, and
  progress. Captions live outside the recording so both views stay clean.
- Voice-over pipeline with auto-detected provider priority: Piper → Google
  Cloud TTS (OAuth) → OpenAI → macOS `say`.
- Story Director: turns a PR diff + test plan into a narrative arc
  (persona, setup, inciting moment, action beats, payoff, close).
- Isolated mode (Supabase + Next.js in Docker per recording) and preview
  mode (Vercel deployments).
- Redesigned cursors: precise desktop pointer + larger mobile touch
  indicator with a distinct tap-ring animation.
- Decoupled from the originating monorepo via `DEMO_AUTH_DIR`,
  `DEMO_POM_MODULE`, `DEMO_STUB_ROUTES_MODULE`, `DEMO_WEB_DIR`, and
  `DEMO_AUTH_PROFILES` environment variables.
- Dependabot config for npm + GitHub Actions with grouped version updates.
