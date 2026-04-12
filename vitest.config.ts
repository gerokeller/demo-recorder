import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * Tests live under `runner/__tests__/**` and `runner/**\/*.test.ts`. Coverage
 * excludes files that are primarily IO or rendering infrastructure (the CLI
 * entry, Remotion JSX components, browser automation) since those are best
 * validated with an end-to-end recording, not unit tests.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['runner/**/*.test.ts', 'runner/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Coverage tracks only the pure-logic modules whose behavior is
      // meaningfully testable without a browser or Docker. The rest of the
      // pipeline (Remotion render, Playwright-driven step execution, TTS
      // subprocesses, isolated Supabase/Next.js env) is validated end-to-end
      // by actual recordings.
      include: ['runner/scenario-schema.ts', 'runner/yaml-parser.ts', 'runner/story-director.ts'],
      thresholds: {
        // Thresholds target the pure-logic surface. The uncovered remainder
        // is IO glue (git/gh subprocesses, file reads) inside story-director.
        lines: 60,
        statements: 60,
        branches: 50,
        functions: 50,
      },
    },
  },
});
