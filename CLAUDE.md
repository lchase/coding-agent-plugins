# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Writing style

Do not use em-dashes (`—`) or en-dashes (`–`) in prose, anywhere: markdown docs, skill and
agent files, code comments, commit messages, PR descriptions. Use a comma, a colon,
parentheses, or two sentences instead. The em-dash is one of the strongest tells that text
was written by an LLM, and this repo ships smart-review and pairs with unslop, so its own
writing should not read as machine-generated. A hyphen in a compound word (`spec-gate`,
`pre-merge`) is fine; it is the sentence-punctuation dash that is banned.

## What this repo is

The **`lchase` Claude Code marketplace** (`.claude-plugin/marketplace.json`), a small
package of independently-installable plugins:

1. **smart-review** (`plugins/smart-review/`) is the flagship: a code-review skill packaged
   for multiple coding harnesses from one shared core under
   `plugins/smart-review/skills/smart-review/`. Each harness gets a thin manifest pointing at
   that same directory, so no skill content is copied or forked. Claude Code additionally
   gets slash commands and native parallel-subagent `max`; other harnesses run the same
   workflow with `max` degraded to a sequential ensemble. The non-Claude entry points
   (`AGENTS.md`, `gemini-extension.json` plus `GEMINI.md`) stay at the **repo root** because
   those conventions are root-scoped; the Cursor and Codex manifests live inside
   `plugins/smart-review/`.

2. **tldraw** (`plugins/tldraw/`) is Claude Code only and unrelated to smart-review. The
   `/tldraw:diagram` skill turns a natural-language diagram description into an editable
   `.tldr` document plus a rendered PNG/SVG. `plugins/tldraw/skills/diagram/` holds SKILL.md,
   `scripts/build-tldr.mjs` (spec to `.tldr`, then shells out to `@kitschpatrol/tldraw-cli`
   for images), and `references/tldr-format.md`. It carries its own version in
   `plugins/tldraw/.claude-plugin/plugin.json`, independent of smart-review.

3. **show-evidence** (`plugins/show-evidence/`) is multi-harness, same packaging shape as
   smart-review: one skill under `skills/show-evidence/`, thin Claude, Cursor, and Codex
   manifests, and a session-start hook for harnesses that do not trigger on the skill
   description. Gemini stays root-scoped, so `GEMINI.md` points at the skill and
   `gemini-extension.json` keeps smart-review's version. The skill writes 1 to 5
   falsifiable claims, then records one replayable artifact per claim (Playwright video
   and trace for UI, test-drive's `record-api.mjs` for HTTP when that plugin is installed,
   otherwise Playwright `request` or Hurl, vhs for a terminal, a script run for a CLI
   or library) and a PROVEN / FAILED / NOT-EVIDENCED table. Per-surface notes live in
   `references/`. Own version, bumped with `plugins/show-evidence/scripts/bump-version.sh`
   (those three manifests only).

4. **test-drive** (`plugins/test-drive/`) is Claude Code only. Two skills form one process:
   `/test-drive:baseline` records the UI as it stands BEFORE the change is made, and
   `/test-drive:compare` replays the identical scenario after it and composes a before/after
   video plus a deterministic verdict. The "before" is never rebuilt from the merge-base, so
   only one version of the app ever boots. Shared `scripts/` at the plugin root:
   `lib.mjs` (arg parsing, validation, boots the app and stamps the result with commit SHA,
   dirty flag, and scenario hash), `record.mjs` (UI: Playwright drive and video, injects
   captions), `record-api.mjs` (backend: HTTP steps, records request, response, and the server
   log lines each step produced, no screen recording; `redact.mjs` scrubs secrets from what it
   stores and `report.mjs` re-scans the final report), `verdict.mjs` (PASS/WARN/FAIL from
   assertions, refuses a baseline whose scenario hash differs), `compose.sh` (ffmpeg, UI) and
   `report.mjs` (transcript report, API). A scenario's `kind` (`ui` default, or `api`) picks
   the driver, and the same two skills handle both. Own version in
   `plugins/test-drive/.claude-plugin/plugin.json`. Both drivers have only been smoke-tested
   against toy servers, so test changes with a real dev server.

5. **factory** (`plugins/factory/`) is Claude Code only. One skill (`/factory`) orchestrates
   eight subagents under `plugins/factory/agents/` through spec, build, four parallel reviews,
   approve, merge. The skill and agents carry nothing repo-specific: every agent reads
   `.factory/repo.md` in the target repo, which `/factory setup` (the `repo-profiler` agent)
   drafts. Job state is `.factory/jobs/<id>/` with one `job.json` per job; `dashboard/serve.ts`
   (Bun) assembles those into `board.json` for `dashboard.html`. Change the loop in
   `skills/factory/SKILL.md`, a stage in its agent file, and keep `repo.md`'s section names
   stable because agents look them up by heading. Own version in
   `plugins/factory/.claude-plugin/plugin.json`. Usage guide: `plugins/factory/README.md`.
6. **token-savings** (`benchmarks/token-savings/`) is not a plugin. It is a community-runnable
   benchmark of Claude Code token and cost claims against pallets/click 8.5.0. Click is
   fetched at a pinned commit, not vendored. Offline checks are `./benchmarks/token-savings/check.sh`.
   A paid `claude -p` run is never part of those checks.

There is no application build. smart-review is markdown plus a small TypeScript eval
harness; tldraw is markdown plus one Node script; show-evidence is markdown.
**Most of this file is about smart-review.**

## Commands

Validate before pushing. `.github/workflows/pr-checks.yml` runs the adapter, redactor,
version, and token-savings checks on pull requests:

```bash
claude plugin validate .                                 # marketplace + plugins
./plugins/smart-review/scripts/validate-adapters.sh       # smart-review manifests: JSON, version match, resolvable paths, agent-lens sync
./plugins/show-evidence/scripts/validate-adapters.sh      # show-evidence manifests: JSON, version match, marketplace entry
node plugins/test-drive/scripts/redact.test.mjs           # test-drive redactor regression check
./benchmarks/token-savings/check.sh                       # shellcheck, grader, synthetic summary; no API spend
```

Bump smart-review's version across all its manifests at once (does not touch tldraw):

```bash
./plugins/smart-review/scripts/bump-version.sh 0.5.0
```

The tldraw plugin versions independently. Edit `plugins/tldraw/.claude-plugin/plugin.json`
by hand. show-evidence versions independently too, across its three harness manifests:

```bash
./plugins/show-evidence/scripts/bump-version.sh 0.1.0
```

Eval harness (`plugins/smart-review/evals/`, Node 18+, dev-only, excluded from the packaged plugin):

```bash
cd plugins/smart-review/evals && npm install
npm run list                        # print corpus manifest, no scoring
npm run score                       # recall/precision, overall + per-case + per-lens
npm run score -- --drop security    # ablation: recall with one lens removed
npm run score -- --window 8         # widen line-match tolerance (default 5)
```

There is no automated "run the reviewer" step. Producing `corpus/<case>/actual.json` (the
input to `npm run score`) means actually invoking the `smart-review` skill on that case's
`after.ts`/`meta.json` inside a harness and saving its findings JSON. `score.ts` reads
`corpus/<case>/{meta,expected,actual}.json` and matches findings on `(category, file, line±window)`.

## Repo layout

```
.claude-plugin/marketplace.json      # the "lchase" marketplace: smart-review + tldraw entries
AGENTS.md                            # repo-level agent pointer (root-scoped convention) -> smart-review
gemini-extension.json + GEMINI.md    # Gemini CLI installs the repo as an extension -> smart-review

plugins/smart-review/                # PLUGIN 1, multi-harness code review
  .claude-plugin/plugin.json         # Claude Code manifest (skills/agents/commands/hooks auto-discovered under here)
  skills/smart-review/               # THE shared core, harness-neutral, one copy
    SKILL.md                         # routing + workflow + output format
    references/
      lenses/{spec-conformance,correctness,security,performance,design,tests}.md
      domain/{api,database,frontend-a11y,typescript-node,jvm-java,python-async,messaging-serialization}.md
      checklist-routing.md           # trigger -> domain checklist -> target lens
      finding-schema.md              # the one shape every lens emits
      merge-contract.md              # dedup / agreement / lead filters / severity rollup / nit cap
      severity.md                    # P0-P3 definitions
      ensemble.md                    # max fan-out, capability check, model panel (default off)
      validation.md                  # static checks + P0 certainty ladder (ran or unproven)
  agents/*-reviewer.md               # Claude Code ONLY, the subagents max dispatches in the isolated variant
  agents/merge-synthesizer.md        # Claude Code ONLY, the merge stage
  commands/*.md                      # Claude Code ONLY, /smart-review:{min,max,review,add-pr-review,review-pr-comments}
  hooks/{session-start,hooks.json,hooks-cursor.json}   # bootstrap nudge for harnesses without description-triggering
  .cursor-plugin/plugin.json         # Cursor manifest -> ./skills/, ./hooks/hooks-cursor.json
  .codex-plugin/plugin.json          # Codex manifest -> ./skills/
  scripts/{validate-adapters.sh,bump-version.sh}
  evals/                             # dev-only eval kit; excluded from what installers pull
  SMART-REVIEW.md                    # the design writeup

benchmarks/token-savings/            # community benchmark, not a marketplace plugin
  arms/*.sh                          # one file per arm; _template.sh is not an arm
  tasks/ patches/ hidden/            # prompts, seeded bugs, grader-only material
  results/README.md                  # runs.jsonl is gitignored; the convention is documented

plugins/tldraw/                      # PLUGIN 2, Claude Code only, self-contained
  .claude-plugin/plugin.json         # own manifest, own version
  skills/diagram/
    SKILL.md                         # node/edge spec -> auto-layout -> .tldr + image
    scripts/build-tldr.mjs           # spec.json -> .tldr, then npx @kitschpatrol/tldraw-cli -> png/svg
    references/tldr-format.md        # .tldr record shapes + the invalidRecords constraints
```

## Architecture: smart-review

The design principle: **the merge is the product, not the lenses.** Six reviewers each
checking one thing beats one reviewer checking six things (attention dilution), and one
model reviewing alone repeats its own blind spots. Everything here exists to get ensemble
recall without ensemble noise.

Modes, routed by `SKILL.md`:
- **`min`**: one context, all six lenses walked in sequence, no fan-out. Fast path for
  small/low-risk diffs. The 90% case.
- **`max`**: spec-gate first (stop early if the diff implements the wrong thing), then the
  ensemble per `references/ensemble.md`. That means **isolated parallel subagents** where the
  harness supports them (Claude Code dispatches `agents/*-reviewer.md`), otherwise a
  disciplined **sequential lens walk**. A model panel (`panel: on` or `per-lens`) is
  optional and off by default; single-model max still merges to one verdict.
- **auto** (plain `/smart-review` or the skill auto-triggering): routes to min or max by
  diff size (>~150 lines or >~5 files), sensitive paths (auth, crypto, SQL, shell/file
  exec, payments, PII), or an explicit pre-merge/thorough ask.
- **`/smart-review:add-pr-review <PR>`** (Claude Code): fetches a PR diff via `gh`, runs
  min/max, then gates on explicit user confirmation of what to publish before posting
  comments. Never approves/requests-changes/merges.
- **`/smart-review:review-pr-comments <PR>`** (Claude Code): triages a PR's *existing*
  unresolved review comments via GraphQL, classifies each fix/docs/explain/disagree, gates
  on approval before editing and before pushing, then replies and resolves each thread. Not
  a review pass.

Key structural pieces, all under `skills/smart-review/references/`:
- **Lenses are fixed**: spec-conformance, correctness, security, performance, design, tests.
  Don't add a seventh lens for a new domain.
- **Domain depth rides in as checklists** (`domain/*.md`), injected into whichever lens
  applies per `checklist-routing.md`. Extending coverage means a new checklist plus a routing
  row, not a new reviewer. That keeps `max`'s cost (5 parallel reviewers) fixed as coverage grows.
- **`finding-schema.md`** is the one shape every lens must emit
  (`{file, line_start, line_end, lens, category, severity, title, why, proposed_move, confidence}`).
  The merge operates mechanically on these fields.
- **`merge-contract.md`**: dedup by `(category, file, line-overlap-within-3)`,
  agreement-weighting (≥2 lenses, or ≥2 models when the panel ran), conflict resolution
  (surface both sides), lead filters (nitpick gravity, hypothetical, preference, Act On
  cap ~5 mapped onto P0-P1 / P2 / P3 / Discarded), severity rollup to a verdict, hard nit
  cap (~5 P3s shown).
- **`validation.md`**: static re-read, blame, caller guards, intentional patterns, library
  version, then a certainty ladder for blocking findings. A P0 hard-blocks only after a
  minimal script or test (`proof: ran`) or an in-app repro. Otherwise tag `unproven` and
  keep it out of the hard-block.
- **`ensemble.md`**: the max fan-out protocol, the harness capability check that picks
  isolated-parallel vs sequential, and the model panel (`off` by default, `on` or
  `per-lens` when configured). Single-model max stays valid.
- **`agents/*-reviewer.md`** (Claude Code) are the isolated-variant subagents, registered
  read-only. Each receives *only* the diff, spec, and its lens (plus routed domain) checklist,
  never the author's session or other reviewers' output; that isolation decorrelates their
  errors. `merge-synthesizer` is the only stage that sees everything. Model diversity is
  the max panel in `ensemble.md` (default off): the orchestrator passes `model` at
  dispatch time, and does not bake `model:` into reviewer frontmatter. **Each reviewer agent is a Claude Code packaging of a `references/lenses/*.md`
  checklist, so keep the two in sync;** `validate-adapters.sh` checks the reference link exists.

The agent running the skill is the orchestrator in `max`, and reviewers never spawn their own
subagents. That agent may itself be a subagent: Claude Code allows nested subagents (three
layers deep by default since 2.1.219), so another plugin such as factory can run smart-review
`max` from inside one of its stages. There is still no "lead reviewer" subagent doing the fan-out.

## Working on this repo

Paths below are relative to `plugins/smart-review/` unless noted. The tldraw plugin is
fully self-contained under `plugins/tldraw/`; its SKILL.md and `references/tldr-format.md`
are the source of truth (the `.tldr` format constraints there, id charset, fractional
index keys, `geo` enum, were hard-won, so keep them). Test a tldraw change by running
`scripts/build-tldr.mjs` on a spec and opening the `.tldr`.

- A change to a lens checklist, the finding schema, the merge contract, or the ensemble
  protocol affects **every mode and every harness** (`min` and the sequential `max` inline
  the same references; the Claude Code reviewer agents mirror the lens files). After editing
  a shared reference, check `SKILL.md`'s workflow and the matching `agents/*-reviewer.md`
  both still make sense.
- Adding harness support means a new manifest pointing at `./skills/` plus (if the harness
  lacks description-triggering) a hooks wrapper. Never fork skill content.
- Bump the version with `scripts/bump-version.sh` so all smart-review manifests stay in
  lockstep (it does not touch the tldraw or show-evidence plugins). show-evidence has its
  own `plugins/show-evidence/scripts/bump-version.sh` for its Claude, Cursor, and Codex
  manifests. That script does not touch `gemini-extension.json`, which stays on
  smart-review's version.
- Eval corpus cases (`evals/corpus/<n>-<lens>-<defect>/`): the `category` in
  `expected.json` must match the vocabulary fixed by `finding-schema.md`, since scoring
  matches on it exactly.
