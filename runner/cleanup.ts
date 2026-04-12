#!/usr/bin/env -S npx tsx

/**
 * Standalone cleanup script for orphaned demo-recorder isolated environments.
 *
 * Usage:
 *   npx tsx demo-recorder-plugin/runner/cleanup.ts
 */

import { cleanupAllIsolatedEnvs } from './env-manager.ts';

try {
  cleanupAllIsolatedEnvs();
} catch (error) {
  console.error('Cleanup failed:', error);
  process.exitCode = 1;
}
