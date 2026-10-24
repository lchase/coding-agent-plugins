---
name: show-evidence
description: >-
  Use after implementing a change and before opening or updating a pull request,
  or before handing the work back to a human. Also use when the user asks to
  prove, verify, show, or demo what changed, or asks for evidence, a recording,
  a trace, or screenshots of the change. Do not use it to review someone else's
  diff (use smart-review) or to record a before/after test drive (use test-drive).
---

# show-evidence

A finished change owes the reviewer proof of specific claims. Each artifact exists to
show one claim (for example "POST /orders returns 201 and a following GET returns the
saved row"). A tour of the app, with no claim attached, is not evidence.

Write the claims before you record anything. Run a checked-in or attached script. Then
mark every claim **PROVEN**, **FAILED**, or **NOT-EVIDENCED**, with a reason, and put
that table where a human will see it.

## Where this fits

**smart-review** ranks a review finding on a ladder in that plugin's
`references/validation.md`: said-so, file:line, walked, ran, reproduced. A blocking P0
needs `ran` or `reproduced`. This skill produces those two rungs as something a person
can open and re-run:

- **ran** (rung 4): a script that imports the same module the app ships and exercises the claim. `references/script-run.md`.
- **reproduced** (rung 5): the same behavior in the running app (UI, HTTP, or CLI). The Playwright, vhs, and Hurl references.

Blocking rules and the P0-P3 scale stay in smart-review. This skill does not merge
findings and does not assign severity.

**test-drive** records one scenario before the edit and replays it after, for a
before/after verdict. Use that when the user wants the comparison. This skill runs
after the change and proves claims about the result. It does not need a baseline, and
it does not rebuild one from the merge-base.

## 1. Write the claims first

From the task, the spec, and the diff, write **1 to 5** claims. Do this before any
recording, screenshot, or trace.

A claim is one sentence a stranger could falsify. It names the input and the observable
result.

- Use: "POST /orders with `{sku: WIDGET-1, qty: 2}` returns 201, and GET /orders/:id returns that sku and qty."
- Use: "The pay button stays disabled until both address fields are non-empty."
- Skip: "Orders work." "The UI looks right." "No regressions."

If the change has no observable behavior (a comment, a rename that cannot change
results), say so and stop. Do not film a tour to fill the gap.

Five is the cap. Pick the claims the task named. You can leave other behavior to the
existing test suite; do not pad the table with claims you never intended to run.

## 2. Pick a surface

One primary artifact per claim. Read that reference before writing the script. Skip the
other references.

| Surface | Evidence | Read |
|---|---|---|
| UI, what a person sees | Playwright video, trace, and a screenshot at the moment the claim is true | `references/playwright-ui.md` |
| HTTP API | Playwright `request` trace: request and response bodies in the trace viewer, no page | `references/playwright-request.md` |
| HTTP API, reviewer should read text | Hurl file with assertions, or a `.http` file plus captured responses | `references/http-transcript.md` |
| CLI, or a terminal picture of curl | vhs tape, plus a script whose exit code is the proof | `references/vhs.md` |
| Library, or a CLI with no picture | Script that imports the shipped module, or a captured transcript of that run | `references/script-run.md` |

Default for HTTP is the Playwright `request` trace. Use Hurl or `.http` when the repo
already keeps those files, or when the proof should be a diffable text file. Use vhs
when the claim is a CLI, or when the user asked to watch a terminal. Do not record all
three for one claim.

**Rejected: a throwaway web app in front of a backend.** A small page whose only job is
to call the API, so there is a browser to film, was considered and dropped. It is a
second app to maintain, it drifts from the handler the change actually shipped, and the
page hides the payload a reviewer needs to see. Record the request and the response
instead.

## 3. Make the run replayable

Evidence is the script plus one run of it. A click-through you cannot repeat is not
evidence.

- The script is a Playwright spec, a vhs tape, a Hurl or `.http` file, or a small
  program. Commit it next to existing tests of the same kind, or under `evidence/` when
  the repo has nowhere else. Attach it to the PR instead of committing only when the
  user told you not to add files.
- The script imports or calls the thing the app ships. Do not copy the function under
  test into the script.
- Write down seed data, base URL, auth fixture, and env vars in the summary. Use
  obviously fake values (`sku: WIDGET-1`, `Bearer test-token`).
- Local or sandbox only. Do not point a recording at production or shared user data.

If the tool for your first choice is missing, switch surface and prove the same claim.
A missing `vhs` binary is a reason to capture a script transcript, not a reason to drop
the claim. **NOT-EVIDENCED** is for when nothing you can run would show it (the server
will not boot, there is no runtime, the claim is not observable).

## 4. Score the run

Run the script once. Then:

| Status | When |
|---|---|
| **PROVEN** | Assertions passed, and a human opening the artifact can see the thing the claim names (status line, body field, screenshot, terminal output). |
| **FAILED** | The run executed and the claim was false, or the product errored. Keep the failing output. |
| **NOT-EVIDENCED** | No artifact shows the claim. The reason says what blocked you. |

Honesty rules:

- A green exit code with an empty, cropped, or unrelated artifact is **NOT-EVIDENCED**. PROVEN needs the artifact itself to show the claim.
- A failed or flaky run is the result. Do not delete it and re-run until the table is green. Two runs that disagree are **FAILED**, reason `flaky`, and you link both outputs.
- You may re-run once after a harness fix (server was not up, wrong port, browser missing). Say so in the reason: "first run: connection refused; started the app; second run passed."
- If the product is wrong, leave the claim **FAILED** or fix the product and say that the first run failed. Do not rewrite the claim to match whatever passed.
- Redact before you upload and before you call anything PROVEN. `references/redaction.md`.

## 5. Package it for a human

Replace any existing `## Evidence` section in the PR body. If there is no PR yet, print
the block in the reply and also write it to the gitignored output directory as
`SUMMARY.md`. Generated media stays out of git either way.

```markdown
## Evidence

| Claim | Status | Why | Artifact | Re-run |
|---|---|---|---|---|
| POST /orders with sku WIDGET-1 qty 2 returns 201, and GET /orders/:id returns that sku and qty | PROVEN | 201, then GET matched sku and qty. Trace has both bodies. | evidence/out/orders/trace.zip | `npx playwright test evidence/orders.spec.ts --trace on` |

**Assumptions:** API at `http://127.0.0.1:3000`. Orders table empty before the run. Auth header is `Bearer test-token` (a fixture).

**Layout:** replay script `evidence/orders.spec.ts` (checked in). Output under `evidence/out/` (gitignored).
```

One row per claim. `Why` is the observation or the blocker, not a restatement of the status word. `Re-run` is one command from the repo root.

### Where files go

Look at the repo under test before choosing paths.

1. If it already gitignores recordings, traces, or test output (`test-results/`, `playwright-report/`, `.test-drive/`, `artifacts/`, `evidence/`), write outputs there.
2. Otherwise create `evidence/out/` and add `/evidence/out/` to `.gitignore`. Add only that ignore. Do not ignore the replay script.
3. Do not commit video, gif, trace zips, response dumps, or `SUMMARY.md`. Upload them on the PR when you can, and always leave the local path in the table.
4. Do not add Playwright, Hurl, or vhs as a product dependency to prove a pure function. Use the runtime the repo already has (`references/script-run.md`). A UI claim may add Playwright as a dev dependency when the repo has a JS toolchain and no browser tests yet.

## Done

- Claims were written before the recording.
- Every claim has a status, a reason, and an artifact path, or a **NOT-EVIDENCED** reason that says why there is no artifact.
- The re-run command is the script a reviewer would actually execute, with seed and env noted.
- Secrets are redacted, or the run used fake credentials only.
- The `## Evidence` block is in the PR body, or in the reply and `SUMMARY.md` when no PR is open.
- Generated media is not staged.
