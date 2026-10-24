# HTTP API, no UI

Read `SKILL.md` first. This is the default for an HTTP claim. There is no page and no video.

Do not build a throwaway web page that calls the API so a browser recording has something to show. That page is a second app, it drifts from the handler you shipped, and it hides the payload.

## When test-drive is installed

Use test-drive's recorder. Do not write a second HTTP client, a Playwright `request` spec, or a Hurl file for the same claim.

Write a `"kind": "api"` scenario. The schema and a worked example ship with that plugin: `references/scenario-api.schema.json` and `references/scenario-api.example.json`. `scripts/record-api.mjs` boots the app, runs the steps over HTTP, and stores each step's request, response, and the server log lines that step produced. It redacts the stored transcript with `scripts/redact.mjs` before writing it.

Map the claim onto the scenario:

- `caption` is the claim, in one sentence.
- `expect` is the falsifier: `status`, and `json` dot-paths for the fields the claim names. `logContains` / `logAbsent` when the claim is about a log line.
- `start.command` listens on `{{PORT}}`. `start.reset` reseeds so a second run sees the same data. `start.readyPath` is a health URL when the app has one.
- Headers and bodies use fixture values (`Bearer test-token`). Add `redact.keys` or `redact.patterns` for anything app-specific (`redaction.md`).
- The schema has no variable passed from one step to the next. A follow-up GET needs an id the reset just seeded, or the claim is a single step.

show-evidence has no before side. Record the after side only. `<test-drive>` is the installed test-drive plugin directory. In a checkout of this marketplace it is `plugins/test-drive`. Do not copy those scripts into the repo under test.

```bash
node <test-drive>/scripts/record-api.mjs \
  --scenario evidence/orders/scenario.json \
  --repo . --side after --out evidence/orders
```

Exit 0 means `evidence/orders/after.result.json` was written. Read it. A step can still be `"status": "failed"` inside that file, and that claim is **FAILED**. Exit 2 is infrastructure (bad scenario, server never ready): fix the harness or mark **NOT-EVIDENCED**, and do not call the claim proven. `after.server.log` is raw server output. Leave it local. Do not attach it.

**PROVEN** when `result.status` is not failed and the redacted transcript shows the status and body the claim names. This is rung 5 (`reproduced`): the running app served the call.

Re-run is the same command. Commit or attach `scenario.json`. Gitignore `after.result.json` and `after.server.log` with the rest of the evidence output.

## When test-drive is not installed

Fall back to a Playwright `request` spec (`APIRequestContext`) with tracing on and video off. One test per claim. The title is the claim. Assert the status and the fields the claim names. `trace: 'on'`, not `'retain-on-failure'`, or a passing run keeps no bodies.

```bash
npx playwright test evidence/orders.spec.ts --trace on
npx playwright show-trace <trace.zip>
```

If the zip has no request or response bodies, the claim is **NOT-EVIDENCED** even when the test passed. Fixture tokens only. A trace zip stores headers in the clear (`redaction.md`).

If the proof should be a text file the repo already runs, and test-drive is still not installed, use `http-transcript.md` instead of this fallback.
