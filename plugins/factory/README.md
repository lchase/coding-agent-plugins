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
              │merge to main│ │ needs-human │ ◄── /factory approve <id>
              └─────────────┘ └─────────────┘
```

## Install

```
/plugin marketplace add lchase/skills      # once
/plugin install factory@lchase
```

Claude Code only. The dashboard needs [Bun](https://bun.sh). The builder needs whatever
your repo needs to run its tests.

## First run in a repo: `/factory setup`

The plugin carries no assumptions about your stack. Everything repo-specific lives in one
file, `.factory/repo.md`, which every agent reads before doing anything:

- test, lint and build commands (per area if you have a backend and a client)
- where your conventions are written (CLAUDE.md, AGENTS.md, style guides) plus rules that are not
- commit prefix rule, signed or not, squash or no-ff merge
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

Whether to commit `.factory/repo.md` and `backlog.md` is up to you. Committing the profile
means teammates get the same factory behaviour; `.factory/jobs/` (runtime state) is always
ignored.

## Running a job

```
/factory <input>
```

`<input>` is one of:

| Input | Example | What happens |
|---|---|---|
| Text | `/factory Add a health endpoint returning ok or degraded` | written verbatim as the feature |
| Bug report as text | `/factory Bug: TTS retries forever when the voice id is invalid` | spec gets a reproduction test as AC1, fix as AC2 |
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

Each job is a folder:

```
.factory/jobs/003-rate-limiting/
  job.json            state, drives the dashboard
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
- the job was approved but your main checkout was dirty or on another branch at merge time.

The branch and worktree stay for you to inspect. Then:

```
/factory approve <job-id>              merge it as it is
/factory rework <job-id> <note>        send it back with your note; the builder treats the note
                                       as a fifth review (VERDICT: CHANGES), then a full review
                                       round runs again
```

Agents never ask questions mid-run. If the input is ambiguous, the spec-writer guesses or the
builder blocks. Make the requirements clear before you start (a requirements doc, a grilled
spec, a well-written ticket) and the factory rarely stops.

## Backlog

`.factory/backlog.md` is a markdown checklist, one item per line (text, a `.md` path, an issue
key, or `#issue`):

```
- [ ] Add a GET /health endpoint returning ok or degraded
- [ ] PROJ-1234
```

`/factory next` takes the first unchecked line, ticks it with the job id, and runs it.

## Dashboard

```
bun "$CLAUDE_PLUGIN_ROOT/dashboard/serve.ts"            # from the repo root
bun "$CLAUDE_PLUGIN_ROOT/dashboard/serve.ts" example    # bundled dummy jobs, to see what it looks like
```

Open <http://localhost:8765>. Six columns (Spec, Build, Review, Approve, Merged, Needs human);
each review round is a row of four chips that fill in as verdicts land; needs-human cards are
highlighted with the command to run. Click a card for a drawer with every file of that job,
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

- No pushes, no pull requests. Merges are local; you push.
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
