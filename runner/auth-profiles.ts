/**
 * Auth profile credentials used by isolated (env-manager.ts) and preview
 * (preview-env.ts) environments when a fresh login is needed.
 *
 * Default profiles are a minimal set for local development and can be
 * overridden via the `DEMO_AUTH_PROFILES` env var, which points at a JSON
 * file shaped like `Record<string, { email, password }>`. Profile names are
 * matched against `settings.auth` in scenario YAML.
 */

import fs from 'node:fs';

const DEFAULT_PROFILES: Record<string, { email: string; password: string }> = {
  ownerUser: { email: 'owner@example.com', password: 'DevOnly!P@ssw0rd-Seed' },
  adminUser: { email: 'admin@example.com', password: 'DevOnly!P@ssw0rd-Seed' },
  viewerUser: { email: 'viewer@example.com', password: 'DevOnly!P@ssw0rd-Seed' },
};

function loadOverrides(): Record<string, { email: string; password: string }> {
  const path = process.env.DEMO_AUTH_PROFILES;
  if (!path) return {};
  try {
    const raw = fs.readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, { email: string; password: string }>;
    }
  } catch (err) {
    console.warn(
      `[demo-recorder] Failed to load auth profiles from ${path}: ${(err as Error).message}`
    );
  }
  return {};
}

export const AUTH_PROFILES: Record<string, { email: string; password: string }> = {
  ...DEFAULT_PROFILES,
  ...loadOverrides(),
};

/**
 * Build the localStorage key that @supabase/supabase-js uses to persist
 * sessions: `sb-<project-ref>-auth-token`. For hosted Supabase the project
 * ref is the first hostname label; for local dev the hostname is used as-is.
 */
export function buildSupabaseStorageKey(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);
    const hostname = url.hostname;
    const projectRef = hostname.includes('.') ? hostname.split('.')[0] : hostname;
    return `sb-${projectRef}-auth-token`;
  } catch {
    return 'sb-localhost-auth-token';
  }
}
