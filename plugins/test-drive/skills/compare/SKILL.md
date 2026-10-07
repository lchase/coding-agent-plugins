---
name: compare
description: >-
  Finish a before/after "test drive" after a UI change is made. Use when the user says
  "compare", "record the after", "show me before and after", "finish the test drive", or has
  just completed a change that /test-drive:baseline was run for. Replays the identical
  scenario on the working tree and gives a deterministic pass/warn/fail verdict, with a
  side-by-side MP4 for UI scenarios or a request/response/log transcript report for API
  scenarios. Needs a baseline; run /test-drive:baseline first.
---

# test-drive compare

Second half of a test drive. The baseline was recorded before the change by
`/test-drive:baseline`. This replays the same scenario file on the changed working tree and
puts the two recordings together (video for UI, transcript for API). The verdict comes from the assertions, not from anyone's
opinion of the video.

Scripts live in `$CLAUDE_PLUGIN_ROOT/scripts/`. Below, `$TD` means that directory.

## Workflow

### 1. Find the baseline

Look in `.test-drive/` for a `<slug>/` with `before.result.json` and no `after.result.json`.
One match: use it. Several: ask which. None: stop and tell the user to run
`/test-drive:baseline` before making changes. Do not invent a before, and do not rebuild one
from the merge-base unasked.

Do not edit `scenario.json`. The verdict refuses a comparison if it changed.

### 2. Record the after

Use the driver that matches the scenario (`"kind": "api"` means `record-api.mjs`):

```bash
node "$TD/record.mjs"     --scenario .test-drive/<slug>/scenario.json --repo . --side after --out .test-drive/<slug>   # UI
node "$TD/record-api.mjs" --scenario .test-drive/<slug>/scenario.json --repo . --side after --out .test-drive/<slug>   # API
```

A failing step is not an error; exit code 2 is infrastructure. Read `after.server.log`,
report the cause, retry at most once after a real fix.

### 3. Verdict, then video or report

```bash
node "$TD/verdict.mjs" --scenario .test-drive/<slug>/scenario.json --dir .test-drive/<slug> --repo .
bash "$TD/compose.sh" .test-drive/<slug>/before.webm .test-drive/<slug>/after.webm .test-drive/<slug>/test-drive.mp4   # UI
node "$TD/report.mjs" --dir .test-drive/<slug>                                                                         # API
```

For UI, add `sequential` as a fourth `compose.sh` argument for before-then-after instead of
side by side. For API, `report.mjs` writes `report.md`: the verdict summary followed by the
before and after request, response, and server log per step. Verdict exit codes: 0 PASS, 1 FAIL (the scenario fails after the change), 2 error (for
example the scenario changed since the baseline), 3 WARN (the baseline did not behave as
`expectBefore` said, the baseline was dirty, or the baseline commit is not an ancestor of
HEAD).

### 4. Report

Verdict first, then the path to `test-drive.mp4` (UI) or `report.md` (API) and `summary.md`, then anything that looked
off (a WARN, a failed step). Keep it short. Do not narrate the recording.

Offer, but do not do without being asked: `gh pr comment <pr> --body-file .test-drive/<slug>/summary.md`
(for API, `report.md` is the better body and is plain markdown). `gh` cannot upload video, so
an MP4 is attached by hand. Review the video or transcript for secrets before sharing it.

## Fallbacks

- **The scenario had to change** (wrong selector): the baseline is void. Recreate the old
  code with `git worktree add <dir> <before.git.sha>`, point the driver with `--side before --repo
  <dir>` at it with the new scenario, then `git worktree remove <dir>`. Tell the user first.
- **No baseline because the change is already made:** same worktree trick at the merge-base.
  Offer it; do not do it silently.

## What to avoid

- Reading the video and declaring success. The assertions decide.
- Widening the scenario to make a WARN go away. A WARN means the scenario may be testing the
  wrong thing; tell the user.
