# Changelog

All notable changes to this project will be documented here. This project
follows [Semantic Versioning](https://semver.org/) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

## [Unreleased]

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
- Unit test suite covering `scenario-schema`, `yaml-parser`,
  `story-director`, `step-executor` pacing math, and the TTS module
  surface (51 tests).
- `runner/doctor.ts` diagnostic script that checks Node, Playwright,
  ffmpeg, Docker, auth state, TTS provider, and `gh` with actionable
  remediations.
- GitHub Actions: CI (typecheck + Biome + format + tests + `npm audit`
  on Ubuntu and macOS) and Dependency Review (blocks high-severity
  dependency introductions). CodeQL runs via GitHub's default code
  scanning setup.
- `SECURITY.md`, `CONTRIBUTING.md`, bug + feature-request issue
  templates, and a PR template.
- Dependabot config for npm + GitHub Actions with grouped version
  updates.
- `scaffoldScenarioYaml` substitutes route placeholders (`<id>`, etc.)
  throughout the emitted narrative, step, and highlight blocks.
