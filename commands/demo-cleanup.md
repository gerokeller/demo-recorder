---
description: Clean up orphaned demo-recorder isolated environments (Docker containers, temp dirs)
---

# /demo-cleanup

Stop and remove all demo-recorder isolated environments, including orphaned
Docker containers from crashed or interrupted recordings.

## Workflow

1. Run the cleanup script:
   ```bash
   npx tsx demo-recorder-plugin/runner/cleanup.ts
   ```

2. Report the results to the user (how many environments were cleaned up).

## When to use

- After a recording was interrupted (Ctrl+C, crash, OOM)
- When Docker is consuming unexpected resources
- Before starting a batch of parallel recordings
- As a periodic maintenance step
