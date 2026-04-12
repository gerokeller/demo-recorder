---
description: "Show detailed information about available demo scenarios."
---

# /demo-scenarios

Show detailed information about all available demo scenarios, including step counts and estimated duration.

## Workflow

1. **Find scenarios:** List all `.yaml` files in `demo-recorder-plugin/scenarios/`.

2. **Parse each file:** Read the full YAML content of each scenario to extract:
   - `name`, `title`, `description`
   - `settings.auth` (auth profile used)
   - `settings.viewport` (resolution)
   - Total number of steps
   - Estimated duration: sum all `pause` step durations plus 2 seconds per non-pause step

3. **Display results:** For each scenario, show a detailed card:

   ### dashboard-overview
   **Title:** Dashboard Command Center Overview
   **Description:** Walk through the dashboard panels, KPI cards, and navigate to the client list.
   **Auth profile:** ownerUser
   **Viewport:** 1280x720
   **Steps:** 12
   **Estimated duration:** ~25 seconds

   ---

4. **Suggest next step:** Tell the user they can run `/demo-record <name>` to record any scenario, or create a new `.yaml` file in `demo-recorder-plugin/scenarios/` following the existing format.
