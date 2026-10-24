# Playwright request (HTTP, no UI)

Read `SKILL.md` first. This is the default for an HTTP claim.

`request` on the Playwright test is an `APIRequestContext`. With tracing on, the trace viewer shows each call's method, URL, request body, status, and response body. There is no page, no video, and no app to film. That is the point.

Do not build a throwaway web page that calls the API so a browser recording has something to show. That page is a second app, it drifts from the handler you shipped, and it hides the payload the trace already stores.

## Fit the repo

Prefer the repo's Playwright config when it has one. A dedicated config is appropriate when the repo's config assumes a browser dev server you do not need:

```ts
// evidence/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: './out/test-results',
  use: {
    baseURL: process.env.API_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on',
    video: 'off',
    screenshot: 'off',
    extraHTTPHeaders: {
      authorization: `Bearer ${process.env.API_TOKEN ?? 'test-token'}`,
    },
  },
});
```

Leave `video` off. Nothing is on screen. If `API_TOKEN` is a real credential, the trace will store it: use a local fixture token, or do not upload the zip (`redaction.md`).

## Spec

One test per claim. The title is the claim. Assert the status and the fields the claim names. A follow-up read proves the write persisted.

```ts
// evidence/orders.spec.ts
import { test, expect } from '@playwright/test';

test('POST /orders returns 201 and GET /orders/:id returns the saved sku and qty', async ({ request }) => {
  const created = await request.post('/orders', {
    data: { sku: 'WIDGET-1', qty: 2 },
  });
  expect(created.status()).toBe(201);
  const body = await created.json();
  expect(body.id).toBeTruthy();

  const fetched = await request.get(`/orders/${body.id}`);
  expect(fetched.status()).toBe(200);
  expect(await fetched.json()).toMatchObject({ sku: 'WIDGET-1', qty: 2 });
});
```

Reset seed data in `beforeAll` (truncate the orders table, or call the app's reset) so a second run sees the same database. Note that reset in Assumptions.

## Re-run

```bash
npx playwright test -c evidence/playwright.config.ts evidence/orders.spec.ts
npx playwright show-trace evidence/out/test-results/<test-folder>/trace.zip
```

In the trace viewer, open the POST and the GET and confirm the bodies match the Why cell. If the zip is missing those bodies, the claim is NOT-EVIDENCED even when the test passed: turn `trace: 'on'` (not `'retain-on-failure'`) and run again. Say that the first zip had no bodies.

This is rung 5 (`reproduced`): the running app served the call.
