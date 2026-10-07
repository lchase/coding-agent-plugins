---
name: baseline
description: >-
  Record how a web UI behaves BEFORE a code change is made, as the first half of a
  before/after "test drive". Use when the user is about to change UI behavior and says
  "test drive", "record the before", "baseline this", "I want a before and after", or wants
  video proof of a UI change for a PR. Run it before editing any code. Writes a scripted
  Playwright scenario and records it against the app as it stands. Finish with
  /test-drive:compare after the change. Web UI only.
---

# test-drive baseline

A test drive is an e2e test that happens to produce video. The "before" is not rebuilt later
from the merge-base. It is recorded now, from the working tree you are about to change, so
only one version of the app ever has to boot. After the change, `/test-drive:compare` replays
the identical scenario and renders both side by side.

Scope: **web UI changes** driven in a browser. For API, CLI, or voice changes, say so and
stop. Do not fake a UI scenario for a non-UI change.

Scripts live in `$CLAUDE_PLUGIN_ROOT/scripts/` (standalone, the `scripts/` directory at the
plugin root). Below, `$TD` means that directory.

## Preconditions

Check these first and report any that fail, rather than working around them.

- No code edits for this change have been made yet. Run `git status`. If the tree is dirty,
  tell the user the baseline may already include part of the change; the verdict will carry
  a WARN. Offer to stash or commit first, and do not do either unasked.
- The repo has a dev-server command that accepts a port.
- `ffmpeg` and `ffprobe` are on PATH (needed later by compare, so fail early here).
- Playwright is installed in the repo (`npm i -D playwright`, then
  `npx playwright install chromium`).

## Workflow

### 1. Scope the intended change

Ask or infer what the user is about to change and what they would see differently: the 1 to
3 behaviors. If nothing user-visible will change, say so and stop.

### 2. Write the scenario

Create `.test-drive/<slug>/scenario.json` in the repo under test (`<slug>` is the branch name
or a short description). Schema: `$CLAUDE_PLUGIN_ROOT/references/scenario.schema.json`.
Example: `$CLAUDE_PLUGIN_ROOT/references/scenario.example.json`.

- **Assert the intended behavior**, the state that should be true after the change. Set
  `expectBefore` to `fail` for a feature or bugfix (the baseline should break at the changed
  step) or `pass` for a refactor or regression guard.
- **Every step has a caption and an `expect`.** The script rejects steps without them.
- **Selectors come from the source.** Grep for the `data-testid`, role, or label. For an
  element that does not exist yet, decide its `data-testid` now and tell the user to add
  exactly that in the change. The scenario is locked after this step.
- **3 to 6 steps.** Synthetic data only; the video captures whatever is on screen.
- If the steps mutate state, set `start.reset` so before and after start from the same data.

Set `start.command` to the dev server with `{{PORT}}`. Add `start.install` only if
dependencies are not already present.

### 3. Record the baseline

```bash
node "$TD/record.mjs" --scenario .test-drive/<slug>/scenario.json --repo . --side before --out .test-drive/<slug>
```

A failing step is **not** an error: recording continues to a red caption and `before.result.json`
records it. Exit code 2 is infrastructure (invalid scenario, server never ready, Playwright
missing). Read `.test-drive/<slug>/before.server.log`, report the cause, retry at most once
after a real fix.

The result also stores the commit SHA, whether the tree was dirty, and a hash of the scenario,
which compare uses to refuse a mismatched comparison.

### 4. Hand back

Report: baseline recorded at `<sha7>`, which steps passed or failed (for `expectBefore: fail`
the changed step should fail, and say if it did not), and the path to `before.webm`. Then
tell the user to make the change and run `/test-drive:compare`. Do not start the change
unless asked.

Keep `.test-drive/` out of git; recordings are build artifacts.

## What to avoid

- Editing `scenario.json` after this step. It invalidates the baseline. If a selector turns
  out wrong, say so and re-record the baseline (see `/test-drive:compare` for the fallback).
- Screenshot-diff assertions. They are flaky and add little over element and text checks.
- Running against shared or production environments. Local dev servers and sandboxes only.
