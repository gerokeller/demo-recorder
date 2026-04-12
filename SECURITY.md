# Security Policy

## Reporting a vulnerability

Please **do not file a public issue** for security vulnerabilities.

Instead, report privately through GitHub's Private Vulnerability Reporting:

1. Open https://github.com/gerokeller/demo-recorder/security/advisories/new
2. Provide a minimal reproduction (ideally with a patched commit or unit test)
3. If relevant, include the affected version, attack scenario, and impact

You should receive an acknowledgement within **3 business days**. Fixes for high/critical issues land within **14 days**; lower-severity issues within **30 days**. You will be credited in the release notes unless you request otherwise.

## Scope

In-scope areas include:

- The recorder itself (`runner/`)
- Scenario parsing and validation
- Story Director (PR data handling)
- TTS pipeline (subprocess spawning, audio file handling)
- Bundled Remotion composition

Out of scope:

- Vulnerabilities in upstream dependencies (report to their maintainers; Dependabot handles updates here)
- Playwright browser vulnerabilities (report to [Microsoft/Playwright](https://github.com/microsoft/playwright/security/policy))
- Issues that require physical or local access to a user's already-compromised machine

## Automated hardening

This repo runs:

- **CodeQL** weekly and on every PR (`security-extended` query pack)
- **Dependency Review** blocking high-severity dependency introductions on PRs
- **Dependabot** for npm + GitHub Actions (security alerts on; grouped version PRs weekly)
- **npm audit** in CI (fails on high/critical advisories)

## Secrets

The recorder never writes secrets to disk. It reads the following from the environment:

| Variable | Used for |
|---|---|
| `OPENAI_API_KEY` | OpenAI TTS requests (optional) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel preview mode auth bypass |
| `PREVIEW_SUPABASE_URL` / `PREVIEW_SUPABASE_ANON_KEY` | Supabase auth in preview mode |

Rotate these as you would any API credential. The recorder does not log their values.
