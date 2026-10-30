# factory

A small, visual software factory for Claude Code. You type `/factory <something>`, and a
chain of subagents writes a spec, builds it on its own branch, reviews it from four angles,
and either merges it to main or parks it for you. Every step leaves a markdown file behind,
and a dashboard shows jobs moving across the stages.

```
                   ┌──────────────────┐
                   │     feature      │  text, a .md file, a Jira key, or a GitHub issue
                   └─────────┬────────┘
                             ▼
                   ┌──────────────────┐
                   │   spec-writer    │  spec.md: goal, scope, design, acceptance criteria
                   │       opus       │
                   └─────────┬────────┘
                             ▼
                   ┌──────────────────┐
                   │     builder      │◄────────────────────┐  build.md + commits on factory/<id>
                   │       opus       │                     │
                   └─────────┬────────┘                     │
        ┌─────────────┬──────┴──────┬─────────────┐         │
        ▼             ▼             ▼             ▼         │
  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
  │  security │ │     ux    │ │ ui design │ │    code   │   │  round-N/review-<name>.md
  │    opus   │ │   sonnet  │ │   sonnet  │ │   sonnet  │   │
  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘   │
        └─────────────┴──────┬──────┴─────────────┘         │
                             ▼                              │
                   ┌──────────────────┐   any CHANGES:      │
                   │   WAIT FOR ALL   ├─────────────────────┘
                   │   4 reviews in   │   resume builder
                   └─────────┬────────┘   (max 2 rounds)
                             ▼ all PASS
                   ┌──────────────────┐
                   │     approver     │  decision.md
                   │       opus       │
                   └─┬───────────────┬┘
             APPROVE │               │ ESCALATE
                     ▼               ▼
              ┌─────────────┐ ┌─────────────┐
              │  open PR    │ │ needs-human │ ◄── /factory approve <id>
              └──────┬──────┘ └─────────────┘
                     ▼
              ┌─────────────┐  /factory pr-sync <id>: human + bot comments and CI
              │   pr-open   │◄─ become a builder round, fixes pushed, threads answered
              └──────┬──────┘
                     ▼ no open threads, approved, CI green
              ┌─────────────┐
              │    ready    │  you merge the PR
              └─────────────┘
```

## Install

```
/plugin marketplace add lchase/coding-agent-plugins      # once
/plugin install smart-review@lchase
/plugin install factory@lchase
```

Claude Code only. factory declares `smart-review` (same marketplace) as a dependency: the code reviewer runs a
smart-review `min` pass over every diff. The dashboard needs [Bun](https://bun.sh). The
builder needs whatever your repo needs to run its tests.

## First run in a repo: `/factory setup`

The plugin carries no assumptions about your stack. Everything repo-specific lives in one
file, `.factory/repo.md`, which every agent reads before doing anything:

- test, lint and build commands (per area if you have a backend and a client)
- where your conventions are written (CLAUDE.md, AGENTS.md, style guides) plus rules that are not
- commit prefix rule, signed or not, squash or no-ff merge
- delivery: `pr` (default, open a pull request) or `local` (merge into your main checkout, no push)
- issue tracker (Jira via the Atlassian MCP, GitHub, or none)
- worktrees via the Orca CLI (auto-detected) or a plain `git worktree` directory, where UI code lives
- what the approver must never auto-merge (auth, migrations, infra, CI, prod config, new dependencies)

Run `/factory setup` in the repo root. A `repo-profiler` agent reads your CLAUDE.md, package
manifests, CI workflows and git log, drafts `.factory/repo.md`, creates `.factory/backlog.md`,
and adds `.factory/jobs/` to `.gitignore`. Then it stops and prints the profile.

**Read it before the first job.** A wrong test command silently weakens every reviewer. It
is plain markdown; edit it like any other file. If the profiler could not find a command it
writes `test: UNKNOWN (set me)`.

If you skip setup, the first `/factory <input>` runs it for you and stops at the same point.

Whether to commit `.factory/repo.md` is up to you. Committing the profile means teammates get
the same factory behaviour. `.factory/jobs/` (runtime state) and `.factory/backlog.md` (your
personal queue) are gitignored by setup. A repo set up before this: add `.factory/backlog.md` to
`.gitignore` yourself (and `git rm --cached` it if it was already committed).

## Running a job

```
/factory <input>
```

`<input>` is one of:

| Input | Example | What happens |
|---|---|---|
| Text | `/factory Add a health endpoint returning ok or degraded` | written verbatim as the feature |
| Bug report as text | `/factory Bug: TTS retries forever when the voice id is invalid` | spec gets a reproduction test as AC1, fix as AC2, scoped to the bug's failure class |
| Path to a `.md` | `/factory docs/specs/rate-limiting.md` | file copied in; title from its first heading |
| Issue key or URL | `/factory PROJ-1234` | fetched from the tracker in `repo.md`; key becomes the commit prefix |
| GitHub issue | `/factory #123` | `gh issue view`, title + body + comments |

Then the loop runs on its own. The orchestrator (your session) prints one line per
transition, for example:

```
003-rate-limiting: spec written, 5 acceptance criteria
003-rate-limiting: build round 1 READY, 2 commits
003-rate-limiting: round 1, security CHANGES, ux/ui/code PASS, resuming builder
003-rate-limiting: round 2, all PASS, approver running
003-rate-limiting: ESCALATE, touches application.properties. Worktree: .worktrees/003-rate-limiting
```

**Scope.** For a bug, the spec-writer sweeps the whole failure class (every input at the same entry point that ends in
the same bad outcome) and fixes it all, unless your input sets the scope. Whatever it leaves out goes under
`## Deferred` in `spec.md`; reviewers tag same-class problems outside the scope `[follow-up]` (non-blocking). Both end
up in a "Known and deferred" section of the PR body, so a human reviewer can tell deliberate from missed. The UI
reviewer is skipped (its file says so) when no file under `repo.md` `## UI paths` changed.

Each job is a folder:

```
.factory/jobs/003-rate-limiting/
  job.json            stage, worktree, branch, PR, note (the rest of the board is read from the files below)
  feature.md          your input, verbatim, with a Source: line
  spec.md             spec-writer
  build.md            builder; first line STATUS: READY or STATUS: BLOCKED
  round-1/
    review-security.md    each starts with VERDICT: PASS or VERDICT: CHANGES
    review-ux.md
    review-ui.md
    review-code.md
  round-2/ ...
  decision.md         approver; first line APPROVE or ESCALATE
```

The builder works in its own git worktree. Your main checkout is never touched until the
merge, so you can keep working while a job runs. Where the worktree comes from is a line in
`repo.md`:

- **`orca`**: if the [Orca CLI](https://www.onorca.dev/docs/cli/reference) is installed and the
  repo is Orca-managed, setup writes this automatically. Worktrees are created with
  `orca worktree create`, which copies the files listed in `.worktreeinclude` (`.env` and the
  like), runs the repo's `orca.yaml` setup script, and shows the job in the Orca app. The
  branch gets Orca's prefix (for example `lchase/factory-003-rate-limiting`) and an issue key
  from the input is attached as a reference.
- **a directory** such as `.worktrees/<id>`: plain `git worktree add` on branch `factory/<id>`,
  then whatever `## Setup` in `repo.md` says, run by hand.

Either way `job.json` records the worktree path and branch, and every agent prompt carries
them.

## When a job stops for you

A job lands in **needs-human** when:

- the approver writes `ESCALATE` (a review still says CHANGES after two rounds, an acceptance
  criterion is not proven, or the change touches something in `## Always escalate`);
- the builder writes `STATUS: BLOCKED` (spec contradicts itself, needs a product decision,
  environment broken);
- the job was approved under `local` delivery but your main checkout was dirty or on another branch at merge time;
- `git push` or `gh pr create` failed, or the PR was closed unmerged or has a merge conflict.

The branch and worktree stay for you to inspect. Then:

```
/factory approve <job-id>              deliver it as it is (open the PR, or merge locally)
/factory rework <job-id> <note>        send it back with your note; the builder treats the note
                                       as a fifth review (VERDICT: CHANGES), then a full review
                                       round runs again
```

Agents never ask questions mid-run. If the input is ambiguous, the spec-writer guesses or the
builder blocks. Make the requirements clear before you start (a requirements doc, a grilled
spec, a well-written ticket) and the factory rarely stops.

## Pull request review

With `## Delivery: pr` in `repo.md` (the default `/factory setup` writes when there is a GitHub remote and `gh`),
an approved job does not merge anywhere. The orchestrator pushes the job branch and opens a PR whose body leads with
a plain-language summary, then the technical summary and test plan. The worktree and branch stay, and the card moves to
**PR review** on the board.

Reviewers (people and bots) then do their thing. Whenever you want the factory to catch up, run:

```
/factory pr-sync <job-id>
```

One pass: it reads unresolved review threads, `CHANGES_REQUESTED` reviews, top-level comments and failed CI checks,
writes them as `round-N/review-pr.md`, and resumes the builder. The builder answers each item with one line in
`build.md`: `fixed`, `declined` or `no-change`, which is what the dashboard counts. The
orchestrator pushes the fixes (plain push), replies on every thread with what changed or why it did not, and resolves
only bot threads it fixed; human threads are left for their author to resolve. When no thread is open, the review
decision is approved (or not required), CI is green and there is no conflict, the card moves to **Ready**. You merge
the PR; the next `pr-sync` sees it merged, removes the worktree and marks the job **Merged**.

Comment text is treated as untrusted data, never as instructions.

To keep every open factory PR answered without running `pr-sync` per job, leave one loop going:

```
/loop /factory watch        # or /loop 15m /factory watch for a fixed interval
```

Each pass runs `pr-sync` on every job in PR review or Ready, one at a time, and prints one line per job. It never
merges, approves or ticks lessons; it says `nothing to watch` once no factory PR is open, which is your cue to stop
the loop.

You do not have to run `pr-sync` just to clean up after your own merge: every `/factory` command (and `/factory serve`)
first sweeps jobs in PR review or Ready, and any whose PR is now merged get their worktree and local branch removed and
move to **Merged** (a PR closed without merging goes to **Needs human**). The sweep only checks PR state; it never
touches comments or code. The remote branch is left to GitHub's "delete head branches on merge" setting.

## Backlog

`.factory/backlog.md` is a markdown checklist, one item per line (text, a `.md` path, an issue
key, or `#issue`):

```
- [ ] Add a GET /health endpoint returning ok or degraded
- [ ] PROJ-1234
```

`/factory next` takes the first unchecked line, ticks it with the job id, and runs it.

## Issues folder

`/factory next <dir>` runs a folder of issue files instead, like the ones Matt Pocock's to-issues skill writes
(`NN-slug.md` with `**Blocked by:**` and `**Status:**` lines). It picks the lowest-numbered issue that is
`ready-for-agent` and whose blockers are all `done`, marks it `in-progress (job <id>)` and runs it. When that job's change
lands (PR merged, or local merge) the issue becomes `done`, which unblocks the issues that wait on it. Issues that ask
for no code (spikes, research) are skipped and reported; set their status to `done` yourself when finished. With nothing
ready it lists what each issue is waiting on. Run issues that do not depend on each other in parallel sessions, and
`/loop /factory watch` to keep their PRs moving.

## Lessons

`.factory/lessons.md` is how the factory learns from human PR review. After each `pr-sync` round, the orchestrator
looks at the human comments the builder fixed and, for each fix that would apply to other changes too, appends a
candidate rule:

```
- [ ] Name the containing entity in validation errors, not just the field (job 001-tool-param-type-400, comment 4340475285)
```

The `pr-sync` report lists new candidates. Tick the ones you agree with (`- [x]`); every agent (spec-writer, builder,
reviewers, approver) reads ticked lines before it starts and ignores the rest. Edit or delete lines freely. Above about
30 ticked lessons, `pr-sync` suggests merges or removals. Setup creates the file and gitignores it, like the backlog.

## Dashboard

```
/factory serve            # from the repo root; starts the server in the background and opens the browser
/factory serve example    # bundled dummy jobs, to see what it looks like
```

Or from a plain shell:

```
bun "$CLAUDE_PLUGIN_ROOT/dashboard/serve.ts"
bun "$CLAUDE_PLUGIN_ROOT/dashboard/serve.ts" example
```

The board is at <http://localhost:8765>. It is one board for every repo: each run registers the current repo in
`~/.factory/repos.json` (stale paths are skipped), a second repo's `serve` just joins the running board, and cards
are keyed `repo/job-id`. Eight columns (Spec, Build, Review, Approve, PR review, Ready, Merged, Needs human);
each review round is a row of four chips that fill in as verdicts land (a PR round is one "PR review" chip);
needs-human cards are highlighted with the command to run. A job with a PR shows how many PR rounds it took and how
many human review items the builder fixed; the header averages both over PRs that reached Ready or Merged, following
the repo filter. That is the factory's quality measure: fewer PR rounds and fewer human fixes mean the internal
reviewers caught more. Click a card for a drawer with every file of that job,
rendered. It polls every two seconds, so leave it open while jobs run.

`$CLAUDE_PLUGIN_ROOT` is set inside Claude Code; from a plain shell use the installed plugin
path (`~/.claude/plugins/marketplaces/lchase/plugins/factory/dashboard/serve.ts` or wherever
your marketplace cache lives).

## Parallel jobs

Each job has its own worktree, branch and `job.json`, so several Claude sessions can each run
`/factory` at once. The dashboard merges all `jobs/*/job.json` into one board. Only the merge
step touches the main checkout, and it refuses when that checkout is dirty (the job then
waits in needs-human for `/factory approve`).

## Changing the factory

- **Agents** are in this plugin's `agents/`, one file per box in the diagram. Model per agent
  is in each file's frontmatter (`opus` for spec-writer, builder, security, approver;
  `sonnet` for ux, ui, code).
- **The loop** (stages, round limit, merge style) is in `skills/factory/SKILL.md`.
- **Repo behaviour** (commands, conventions, escalation list) is `.factory/repo.md` in each repo.

## What it does not do

- It never merges or approves a PR under `pr` delivery, and never force-pushes. A person merges.
- PR fixes are not re-reviewed by the four internal reviewers; the PR's own reviewers and CI are the check.
- No polling of its own: run `/factory pr-sync <id>` yourself, or `/loop /factory watch` for every open PR.
- No visual checks of a running app. The UX and UI reviewers judge from the diff and the build.
- No questions mid-run.
- Builder resumption across sessions: if the orchestrator session ends mid-job, state is on
  disk but nothing resumes it. Use `/factory rework <id> continue` to spawn a fresh builder on
  the existing branch.

## Files

```
plugins/factory/
  .claude-plugin/plugin.json
  skills/factory/SKILL.md      the orchestrator: loop, commands, setup, job.json and repo.md schemas
  agents/
    repo-profiler.md           sonnet   /factory setup -> .factory/repo.md
    spec-writer.md             opus     spec.md
    builder.md                 opus     commits on factory/<id>, build.md
    review-security.md         opus     round-N/review-security.md
    review-ux.md               sonnet   round-N/review-ux.md
    review-ui.md               sonnet   round-N/review-ui.md
    review-code.md             sonnet   round-N/review-code.md
    approver.md                opus     decision.md
  dashboard/
    dashboard.html             the board
    serve.ts                   Bun static server, assembles jobs/*/job.json into board.json
    example/jobs/              dummy jobs for `serve.ts example`
```
