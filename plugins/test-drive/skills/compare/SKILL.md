---
name: compare
description: >-
  Finish a before/after "test drive" after a UI change is made. Use when the user says
  "compare", "record the after", "show me before and after", "finish the test drive", or has
  just completed a change that /test-drive:baseline was run for. Replays the identical
  scenario on the working tree, composes a labeled side-by-side MP4 with the baseline, and
  gives a deterministic pass/warn/fail verdict. Needs a baseline; run /test-drive:baseline
  first. Web UI only.
---

# test-drive compare

Second half of a test drive. The baseline was recorded before the change by
`/test-drive:baseline`. This replays the same scenario file on the changed working tree and
puts the two recordings together. The verdict comes from the assertions, not from anyone's
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

```bash
node "$TD/record.mjs" --scenario .test-drive/<slug>/scenario.json --repo . --side after --out .test-drive/<slug>
```

A failing step is not an error; exit code 2 is infrastructure. Read `after.server.log`,
report the cause, retry at most once after a real fix.

### 3. Verdict and video

```bash
node "$TD/verdict.mjs" --scenario .test-drive/<slug>/scenario.json --dir .test-drive/<slug> --repo .
bash "$TD/compose.sh" .test-drive/<slug>/before.webm .test-drive/<slug>/after.webm .test-drive/<slug>/test-drive.mp4
```

Add `sequential` as a fourth `compose.sh` argument for before-then-after instead of side by
side. Verdict exit codes: 0 PASS, 1 FAIL (the scenario fails after the change), 2 error (for
example the scenario changed since the baseline), 3 WARN (the baseline did not behave as
`expectBefore` said, the baseline was dirty, or the baseline commit is not an ancestor of
HEAD).

### 4. Report

Verdict first, then the path to `test-drive.mp4` and `summary.md`, then anything that looked
off (a WARN, a failed step). Keep it short. Do not narrate the recording.

Offer, but do not do without being asked: `gh pr comment <pr> --body-file .test-drive/<slug>/summary.md`.
`gh` cannot upload video, so the MP4 is attached by hand. Review the video for secrets
before sharing it.

## Fallbacks

- **The scenario had to change** (wrong selector): the baseline is void. Recreate the old
  code with `git worktree add <dir> <before.git.sha>`, point `record.mjs --side before --repo
  <dir>` at it with the new scenario, then `git worktree remove <dir>`. Tell the user first.
- **No baseline because the change is already made:** same worktree trick at the merge-base.
  Offer it; do not do it silently.

## What to avoid

- Reading the video and declaring success. The assertions decide.
- Widening the scenario to make a WARN go away. A WARN means the scenario may be testing the
  wrong thing; tell the user.
