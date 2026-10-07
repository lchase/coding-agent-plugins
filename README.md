# lchase

Lawrence Chase's Claude Code marketplace: code review and diagram tools for Claude Code
and other coding agents.

```
/plugin marketplace add lchase/skills
/plugin install smart-review@lchase
/plugin install tldraw@lchase
/plugin install test-drive@lchase
```

Each plugin is independent; install only what you want. `@lchase` is the marketplace name
(from `.claude-plugin/marketplace.json`), not the GitHub slug.

### Updating

New versions ship whenever the `version` string in a plugin's manifest changes. Claude Code
**refreshes marketplaces in the background by default**, so you normally pick up updates
without doing anything. To pull them right now:

```
/plugin marketplace update lchase      # refresh this marketplace's manifest
/plugin update smart-review@lchase     # apply a pending update to one plugin
/plugin update tldraw@lchase
```

`/plugin marketplace update` (no name) refreshes every marketplace. From a shell:
`claude plugin marketplace update lchase` and `claude plugin update <plugin>@lchase`.

### Reinstalling

If a plugin gets into a bad state (stale cached script, half-applied update), do a clean
reinstall:

```
/plugin uninstall tldraw
/plugin marketplace update lchase
/plugin install tldraw@lchase
```

Nuclear option, re-register the whole marketplace:

```
/plugin marketplace remove lchase
/plugin marketplace add lchase/skills
/plugin install smart-review@lchase
/plugin install tldraw@lchase
```

### Migrating from the old layout

Before this repo became a multi-plugin marketplace it published one plugin from the repo
root under a marketplace named `chase`. If you installed it back then, clear the old
registration first:

```
/plugin uninstall smart-review
/plugin uninstall tldraw            # only if you installed the short-lived tldraw@chase
/plugin marketplace remove chase
/plugin marketplace add lchase/skills
/plugin install smart-review@lchase
/plugin install tldraw@lchase
```

The tldraw skill's command also changed: `/tldraw:tldraw` → **`/tldraw:diagram`**.

| Plugin | What it does | Skills / commands | Harnesses |
|---|---|---|---|
| [**smart-review**](plugins/smart-review/) | Ensemble code review: six specialized lenses over a diff, merged into one deduplicated, severity-ranked verdict | `/smart-review:{review,min,max,add-pr-review,review-pr-comments}` + auto-trigger | Claude Code, Cursor, Codex, Gemini CLI, any AGENTS.md agent |
| [**tldraw**](plugins/tldraw/) | Natural-language description → editable tldraw document (`.tldr`) + rendered PNG/SVG | `/tldraw:diagram` + auto-trigger | Claude Code only (needs Node + `npx`) |
| [**test-drive**](plugins/test-drive/) | Before/after evidence of a UI or API change: record the app before you edit, replay the same scripted scenario after, with a deterministic verdict | `/test-drive:{baseline,compare}` + auto-trigger | Claude Code only (needs Node; UI also needs Playwright and ffmpeg) |

---

## smart-review

*An ensemble code review: several specialized lenses, one merged verdict, not another pile
of comments.*

Most code review, human or AI, is one reviewer making a single pass and leaving a list of
comments. This runs six specialized lenses instead (spec-conformance, correctness,
security, performance, design, and tests), then merges the results into one verdict:
duplicates collapsed, findings that several lenses independently raise weighted up,
conflicting advice reconciled, severity rolled up, structural problems first, nits capped.
The merge is the point. An ensemble without it is just louder, and a longer checklist
handed to one reviewer only dilutes its attention and repeats its own misses.

Two modes: a fast single pass (`min`) for tight loops, and an orchestrated ensemble (`max`)
for pre-merge review. Auto-routing picks between them by change size and sensitivity.

The skill lives in [`plugins/smart-review/skills/smart-review/`](plugins/smart-review/skills/smart-review/)
as harness-neutral markdown. Each harness gets a thin manifest pointing at that same
directory, so no skill content is copied or forked.

| Harness | Install | `min` | `max` | Slash commands / auto-trigger |
|---|---|---|---|---|
| Claude Code | `/plugin marketplace add lchase/skills` then `/plugin install smart-review@lchase` | ✅ | ✅ isolated parallel subagents | ✅ |
| Cursor | point Cursor at `plugins/smart-review/.cursor-plugin/` | ✅ | ✅ sequential ensemble | via session-start hook |
| Codex | `plugins/smart-review/.codex-plugin/` manifest | ✅ | ✅ sequential ensemble | no |
| Gemini CLI | `gemini extensions install https://github.com/lchase/skills` (reads root `gemini-extension.json`) | ✅ | ✅ sequential ensemble | via `GEMINI.md` |
| Any AGENTS.md agent | reads root [`AGENTS.md`](AGENTS.md) | ✅ | ✅ sequential ensemble | no |

`max`'s isolated parallel subagents are a Claude Code capability. A model panel
(`plugins/smart-review/skills/smart-review/references/ensemble.md`, off by default) rides
on top when the harness can route more than one model. Otherwise max is single-model.
Elsewhere `max` runs the same spec-gate, six lenses, and merge as a disciplined
sequential walk. Design and internals: [`plugins/smart-review/SMART-REVIEW.md`](plugins/smart-review/SMART-REVIEW.md).

**Claude Code slash commands:**

- `/smart-review:review`: auto (routes to min or max by size + sensitivity)
- `/smart-review:min`: fast single-pass review
- `/smart-review:max`: orchestrated ensemble review
- `/smart-review:add-pr-review <PR number or URL>`: reviews a GitHub PR and, after you confirm what to publish, posts the findings as PR comments
- `/smart-review:review-pr-comments <PR number or URL>`: triages a PR's existing unresolved review comments, fixes or explains each after your approval, replies, and resolves the thread

The skill also triggers automatically when you ask Claude to review a diff, PR, or branch.

---

## tldraw

Turn a described diagram (flowchart, architecture / system diagram, process map, decision
tree, state machine) into two artifacts: an **editable `.tldr` document** (opens at
tldraw.com or in the tldraw editor) and a **rendered PNG/SVG** for docs and PRs.

Claude writes a `{nodes, edges}` spec from your description; a bundled Node script does a
simple layered auto-layout, emits the `.tldr`, and renders images by loading it into a
headless-Chromium tldraw instance via [`@kitschpatrol/tldraw-cli`](https://github.com/kitschpatrol/tldraw-cli)
(first run downloads Chromium, ~1 min, cached).

```
/plugin install tldraw@lchase
```

Claude Code only. Skill: `/tldraw:diagram` (also auto-triggers on "draw this diagram",
"diagram this flow", "make a tldraw of…"). Details:
[`plugins/tldraw/skills/diagram/SKILL.md`](plugins/tldraw/skills/diagram/SKILL.md).

---

## test-drive

A test drive is an e2e test that happens to produce video, and the "before" is part of the
process rather than something reconstructed later. Run `/test-drive:baseline` before you
edit: it writes a short browser scenario and records the app as it stands. Make the change,
then run `/test-drive:compare`: it replays the identical scenario with Playwright and
composes a labeled side-by-side MP4. The pass/warn/fail verdict comes from the scenario's
assertions, not from reading the video.

Backend changes work the same way with `"kind": "api"`: the scenario is a list of HTTP steps
(method, path, body, expected status, JSON fields, and server-log lines to expect or avoid).
There is nothing to screen-record, so each step captures the request, the response, and the
server log lines it produced, and compare writes a before/after `report.md` instead of a video.
Secrets are redacted from the stored transcript (best effort, extendable per scenario with
`redact`), and the finished report is scanned and flagged if anything still looks secret.

```
/plugin install test-drive@lchase
```

Claude Code only. UI scenarios need `ffmpeg` and Playwright in the repo under test; API
scenarios need only Node 18+. Only the working tree is ever run, so there is no second checkout to boot.
Details: [`baseline`](plugins/test-drive/skills/baseline/SKILL.md) and
[`compare`](plugins/test-drive/skills/compare/SKILL.md).

---

## Repo layout

```
.claude-plugin/marketplace.json   # the "lchase" marketplace: 3 plugin entries
AGENTS.md                         # repo-level agent pointer (→ smart-review)
gemini-extension.json + GEMINI.md # Gemini CLI installs the repo as an extension (→ smart-review)

plugins/smart-review/             # plugin 1, multi-harness code review
  .claude-plugin/plugin.json
  skills/smart-review/            # the harness-neutral core (SKILL.md + references/)
  agents/ commands/ hooks/        # Claude Code packaging
  .cursor-plugin/ .codex-plugin/  # thin per-harness manifests
  scripts/                        # validate-adapters.sh, bump-version.sh
  evals/                          # dev-only eval kit (not shipped to installers)
  SMART-REVIEW.md                 # design writeup

plugins/tldraw/                   # plugin 2, Claude Code only
  .claude-plugin/plugin.json
  skills/diagram/                 # SKILL.md + scripts/build-tldr.mjs + references/

plugins/test-drive/               # plugin 3, Claude Code only
  .claude-plugin/plugin.json
  skills/{baseline,compare}/      # SKILL.md each
  scripts/{lib.mjs,record.mjs,record-api.mjs,redact.mjs,verdict.mjs,compose.sh,report.mjs}   # shared by both skills
  references/                     # UI and API scenario schemas + examples
```

## Developing

```
claude plugin validate .                                # marketplace + all plugins
./plugins/smart-review/scripts/validate-adapters.sh      # smart-review's per-harness manifests
```

**Releasing:** users only get an update when a plugin's `version` string changes, so bump
it on every user-facing change and push to `main`.

- smart-review: version is pinned across all its manifests; bump them together with
  `./plugins/smart-review/scripts/bump-version.sh <version>`.
- tldraw: versions independently; edit `plugins/tldraw/.claude-plugin/plugin.json`.

Once pushed, installed clients pick it up on their next background marketplace refresh, or
immediately with `/plugin marketplace update lchase`.
