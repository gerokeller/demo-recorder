---
description: "List available demo scenario files."
---

# /demo-list

List all available demo recording scenarios.

## Workflow

1. **Find scenarios:** List all `.yaml` files in `demo-recorder-plugin/scenarios/`.

2. **Read each file:** For each scenario, read the first few lines to extract the `name`, `title`, and `description` fields.

3. **Display results:** Show a table with columns: Name, Title, Description.

   Example output:

   | Name | Title | Description |
   |------|-------|-------------|
   | dashboard-overview | Dashboard Command Center Overview | Walk through the dashboard panels, KPI cards, and navigate to the client list. |
   | client-onboarding | Client Onboarding Flow | Demonstrate creating a new client, viewing the detail page, and exploring the quote studio. |

4. **Suggest next step:** Tell the user they can run `/demo-record <name>` to record any scenario.
