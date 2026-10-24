# Playwright, UI

Read `SKILL.md` first. Use this when the claim is about something a person sees.

The proof is a Playwright test whose title is the claim. The run records three things:

- **Video** of the scripted path.
- **Trace**, so a reviewer can step the actions (`npx playwright show-trace <zip>`).
- **A screenshot taken at the moment the claim is true**, not only whatever frame the video happens to stop on.

PROVEN means the assertion passed and that screenshot (or a frame you name) shows the state the claim describes. A passing `toBeVisible` with a black video is NOT-EVIDENCED until a frame shows the UI.

## Fit the repo

If the repo already has Playwright, add the spec next to those tests and run it with the repo's config. Force a trace for this run even when CI leaves tracing off:

```bash
npx playwright test e2e/order-row.spec.ts --trace on --video on
```

Copy `trace.zip` and the video into the gitignored output dir if `test-results/` is noisy or not ignored. Point the summary at the files you want a human to open.

If the repo has no Playwright setup, a minimal config under `evidence/` is fine and may be committed with the spec. Install Playwright as a dev dependency. Do not stand up a second app.

```ts
// evidence/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: './out/test-results',
  use: {
    baseURL: process.env.APP_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on',
    video: 'on',
  },
});
```

```bash
npx playwright test -c evidence/playwright.config.ts
```

## Spec

The test title is the claim. Seed through the app's own reset, or through an API the test calls in `beforeEach`. Fake data only.

```ts
// evidence/order-row.spec.ts
import { test, expect } from '@playwright/test';

test('the orders table shows WIDGET-1 with qty 2 after checkout', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByLabel('SKU').fill('WIDGET-1');
  await page.getByLabel('Qty').fill('2');
  await page.getByRole('button', { name: 'Place order' }).click();

  const row = page.getByRole('row', { name: 'WIDGET-1' });
  await expect(row).toContainText('2');
  await page.screenshot({ path: 'evidence/out/order-row.png' });
});
```

`screenshot: 'on'` in the config captures the last frame of the test, which may be after a navigation. Take the named screenshot at the assertion anyway.

## Assumptions to write down

Base URL, the account or empty database you started from, viewport if the claim depends on it, and any clock or feature flag you pinned. The summary's Assumptions line carries these. The spec should set them, not rely on whatever was left in a developer's browser profile.

## Re-run

One command, from the repo root, plus how to open the trace:

```bash
npx playwright test evidence/order-row.spec.ts --trace on --video on
npx playwright show-trace evidence/out/test-results/<test>/trace.zip
```

Trace zips contain request headers. Use a fixture user and a fake token. Scan before upload (`redaction.md`).
