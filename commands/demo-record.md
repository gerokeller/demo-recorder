---
description: "Record a browser video demo from a pre-written scenario."
argument-hint: "[scenario-name]"
---

# /demo-record

Record a video demo of a feature by replaying a pre-written Playwright scenario.

## Workflow

1. **Resolve scenario:** If an argument is provided, look for `demo-recorder-plugin/scenarios/<argument>.yaml`. If no argument is given, list available scenarios in `demo-recorder-plugin/scenarios/` and ask the user to pick one.

2. **Validate scenario exists:** Read the YAML file and confirm it has valid `name`, `title`, `description`, and `steps` fields. If the file is missing, show available scenarios and ask the user to choose.

3. **Check prerequisites:**
   - Resolve the base URL: check `PLAYWRIGHT_BASE_URL` env var first, then `settings.baseUrl` in the scenario YAML, then fall back to `http://localhost:3000`.
   - Verify the web app is running: `curl -sf <resolved-base-url> > /dev/null`. If not reachable, tell the user to start the dev server with `npm run dev`.
   - Check auth state exists: look for `web/e2e/.auth/ownerUser.json` (or the profile specified in the scenario's `settings.auth`). If missing, tell the user to run `cd web && npx playwright test --project=setup`.

4. **Run the recorder:**
   ```bash
   npx tsx demo-recorder-plugin/runner/record.ts demo-recorder-plugin/scenarios/<name>.yaml
   ```

5. **Report results:** Show the output video path, file size, and scenario title. If the recording failed, show the error output and suggest debugging steps.

## Error Handling

| Error | Resolution |
|-------|------------|
| Scenario file not found | List available scenarios |
| Auth state missing | Run `cd web && npx playwright test --project=setup` |
| Web app not running | Run `npm run dev` in another terminal |
| Browser not installed | Run `npx playwright install chromium` |
| Step execution failure | Show the failing step number and error; partial video may still be saved |
