import type { Page } from 'playwright';

/**
 * Stub background routes to prevent noisy API calls from bleeding into the
 * recording. The standalone version is a **no-op by default**: consumers
 * who need to mute specific routes can point `DEMO_STUB_ROUTES_MODULE` at a
 * local module that exports a `stubBackgroundRoutes(page)` function.
 *
 * Example custom module:
 *
 *   // stubs.ts
 *   import type { Page } from 'playwright';
 *   export async function stubBackgroundRoutes(page: Page): Promise<void> {
 *     await page.route('**\/api/notifications/**', (route) =>
 *       route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' })
 *     );
 *   }
 *
 * Then run:
 *
 *   DEMO_STUB_ROUTES_MODULE=./stubs.ts npx demo-recorder scenarios/my-demo.yaml
 */
export async function stubBackgroundRoutes(page: Page): Promise<void> {
  const customModulePath = process.env.DEMO_STUB_ROUTES_MODULE;
  if (customModulePath) {
    try {
      const mod = (await import(customModulePath)) as {
        stubBackgroundRoutes?: (page: Page) => Promise<void>;
      };
      if (typeof mod.stubBackgroundRoutes === 'function') {
        await mod.stubBackgroundRoutes(page);
        return;
      }
      console.warn(
        `[demo-recorder] ${customModulePath} did not export stubBackgroundRoutes(page); skipping.`
      );
    } catch (err) {
      console.warn(
        `[demo-recorder] Failed to load stub module ${customModulePath}: ${(err as Error).message}`
      );
    }
  }

  // Default: stub the PWA manifest request so apps that expect one don't
  // log 404s during recording. Everything else goes through unchanged.
  await page.route('**/manifest.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/manifest+json',
      body: JSON.stringify({
        name: 'Demo',
        short_name: 'Demo',
        start_url: '/',
        display: 'standalone',
      }),
    })
  );
}
