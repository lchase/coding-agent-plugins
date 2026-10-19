---
name: factory
description: Run a feature or bug through the software factory loop (spec, build, 4 parallel reviews, approve, merge) on its own branch. Use for /factory <feature | path.md | JIRA-123 | #issue>, /factory next, /factory approve <job-id>, /factory rework <job-id> <note>, /factory setup.
---

# /factory

The session that runs this skill is the **orchestrator** of one job. It runs the loop below, spawns every agent with the
Agent tool, and is the **only writer of that job's `.factory/jobs/<id>/job.json`**. Agents never see this conversation:
every agent gets its context from files under `.factory/` and writes only its own file. You never write specs, code,
reviews or decisions yourself.

Agents ship with this plugin; when installed they are listed as `factory:<name>` (e.g. `factory:builder`). Use that as
`subagent_type`.

## Step 0: repo profile

Everything repo-specific (test and lint commands, conventions, commit prefix, issue tracker, worktree dir, escalation
list) lives in **`.factory/repo.md`**, which every agent reads first. If it does not exist, run **`/factory setup`**
(below) and stop; do not start a job in the same run. The user reviews the profile first, since a wrong test command
silently weakens every reviewer.

## The loop (edit this to change the factory)

```
                   ┌──────────────────┐
                   │     feature      │  .factory/jobs/<id>/feature.md   (orchestrator)
                   └─────────┬────────┘
                             ▼
                   ┌──────────────────┐
                   │   spec-writer    │  spec.md
                   │       opus       │
                   └─────────┬────────┘
                             ▼
                   ┌──────────────────┐
                   │     builder      │◄────────────────────┐  build.md, commits on factory/<id>
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
                             ▼ all PASS (or round 2 done)
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

Agent definitions live in this plugin's `agents/` (one file per box). Model per agent is set there.

## Files

```
<repo>/.factory/repo.md                       repo profile (from /factory setup), read by every agent
<repo>/.factory/backlog.md                    queue for /factory next
<repo>/.factory/jobs/<id>/job.json            job state (orchestrator writes, dashboard reads)
<repo>/.factory/jobs/<id>/feature.md          the request, verbatim (orchestrator)
<repo>/.factory/jobs/<id>/spec.md             spec-writer
<repo>/.factory/jobs/<id>/build.md            builder
<repo>/.factory/jobs/<id>/round-<N>/review-{security,ux,ui,code,human}.md
<repo>/.factory/jobs/<id>/decision.md         approver
<repo>/<worktree dir>/<id>/                   the job's worktree on branch factory/<id>  (dir from repo.md)
```

`.factory/jobs/` is runtime state and gitignored (setup adds it). Each job has its own worktree, branch and `job.json`,
so several sessions can run `/factory` at once, one job per session. Only **Merge** touches the main checkout.

## Commands

| Command | What the orchestrator does |
|---|---|
| `/factory setup` | Profile the repo into `.factory/repo.md` (see below) |
| `/factory <input>` | New job from text, a `.md` path, an issue-tracker key/URL, or a GitHub issue; run the loop |
| `/factory next` | Take the first `- [ ]` line in `.factory/backlog.md`, tick it `- [x] <item> (<job-id>)` with one Edit (if the Edit fails, another session claimed it: take the next line), run the loop |
| `/factory approve <job-id>` | Merge a `needs-human` job into main (step 7) |
| `/factory rework <job-id> <note>` | Write `round-N+1/review-human.md` (`VERDICT: CHANGES`, blank line, the note verbatim), stage `build`, resume builder with the step 5 message for round `N+1`; reviews then run as round `N+2` |

## /factory setup

1. `mkdir -p .factory`. Spawn `repo-profiler` with prompt `Repo root: <absolute path>. Write .factory/repo.md.` Wait.
2. If `.factory/backlog.md` is missing, write it with the header `# Factory backlog` and one line explaining
   `- [ ] <feature>` per line.
3. Ensure `.gitignore` contains `.factory/jobs/` and the worktree dir from `repo.md` (append if missing).
4. Print `repo.md` in full and stop: "Review `.factory/repo.md`, then run your `/factory` command again." Whether
   `repo.md` and `backlog.md` get committed is the user's call.

## Procedure

Run every step in order. Rewrite `job.json` whole after each change (schema below). Report one short line per
transition, e.g. `003-rate-limiting: round 2, security CHANGES, ux/ui/code PASS, resuming builder`. Never skip the wait
in step 5. `<wt>` below is `<worktree dir>/<id>` from `repo.md`.

1. **Create the job.** `id` = next 3-digit number after the highest folder in `.factory/jobs/` (`001` if none) + `-` +
   kebab slug (max 4 words), e.g. `003-rate-limiting`. Claim it with `mkdir .factory/jobs/<id>` (no `-p`); if that fails
   another session took the number, pick the next. Write `feature.md` from the argument, which is one of:
   - **text** describing a feature or a bug: write it verbatim.
   - **path to a `.md` file** (e.g. a requirements doc): copy its content; title from its first heading.
   - **issue-tracker key or URL** (format and fetch method in `repo.md` `## Issue tracker`, e.g. Jira via the Atlassian
     MCP `getJiraIssue`): write summary as the title, then description, acceptance criteria and comments as text.
   - **GitHub issue** (`#123` or an issues URL): `gh issue view <n> --json title,body,comments`; same layout.

   `feature.md` always starts with `Source: <text | path | KEY-123 | #123>` then a blank line then the content. If a
   fetch fails, stop and tell the user; never guess the content. Bugs go through the same loop: the spec-writer turns
   them into a reproduction test plus the fix. Write `job.json`: stage `spec`, round `0`.

2. **Spec.** Spawn `spec-writer` with prompt: `Job folder: .factory/jobs/<id>`. Wait; check `spec.md` exists. Set stage
   `build`.

3. **Worktree + builder.** `git worktree add <wt> -b factory/<id> <main branch>`. Run any fresh-checkout setup `repo.md`
   lists, in the worktree. Spawn `builder` with `name: builder-<id>` and prompt:
   `Job folder: .factory/jobs/<id>. Worktree: <wt>. Round: 1.`
   Wait for it to finish, then **Build check**: read the first line of `build.md`. `STATUS: READY` → step 4.
   `STATUS: BLOCKED` → stage `needs-human`, `note` = the blocked reason, stop and tell the user.

4. **Reviews (parallel).** `mkdir -p .factory/jobs/<id>/round-<N>`. Set stage `review`, round `N`, all four `reviews` to
   `pending`. In ONE message spawn `review-security`, `review-ux`, `review-ui`, `review-code`, each with prompt:
   `Job folder: .factory/jobs/<id>. Worktree: <wt>. Round folder: .factory/jobs/<id>/round-<N>.`

5. **WAIT FOR ALL.** The round is complete only when all four files `round-<N>/review-{security,ux,ui,code}.md` exist.
   As each lands, read its first line and write that verdict (`PASS` or `CHANGES`) to `job.json` straight away so the
   chips fill in. A reviewer that finishes without a valid first line: stop and tell the user. Never resume the builder
   while any file is missing.
   - All `PASS` → step 6.
   - Any `CHANGES` and `N < 2` → push `reviews` onto `rounds`, set stage `build`, round `N+1`, `reviews` all `pending`.
     Resume the builder with `SendMessage` to `builder-<id>`:
     `Round <N+1>. Read every review in .factory/jobs/<id>/round-<N>, fix every CHANGES item, update build.md (keep STATUS line first, add a "## Round <N+1>" section), commit.`
     If the builder no longer exists (new session), spawn `builder` again with the same name and the same text. When it
     finishes → **Build check**, then step 4 with `N+1`.
   - Any `CHANGES` and `N == 2` → step 6 anyway; the approver sees the unresolved items.

6. **Approve.** Set stage `approve`. Spawn `approver` with prompt `Job folder: .factory/jobs/<id>. Worktree: <wt>.`
   Wait. Read the first line of `decision.md`.
   - `APPROVE` → step 7.
   - `ESCALATE` → stage `needs-human`, `note` = one line from `## Reason`. Stop and tell the user the job id, the
     worktree path, and the reason.

7. **Merge.** From the main checkout, which must be on the main branch with
   `git status --porcelain -- . ':!.factory/backlog.md'` empty. If not, set stage `needs-human`, `note` =
   `approved, main checkout busy`, and tell the user to run `/factory approve <id>` once it is clean. Otherwise merge
   with the style `repo.md` `## Commits` gives (squash or no-ff, signed or not), commit title
   `<prefix> <feature title>`, then:
   ```bash
   git worktree remove <wt> && git branch -D factory/<id>
   ```
   If the merge fails: `git reset --merge`, stage `needs-human`, `note` = why. On success set stage `merged`, report the
   commit hash. Do not push.

## job.json schema

```json
{
  "id": "003-rate-limiting", "title": "Rate limiting", "branch": "factory/003-rate-limiting",
  "stage": "review",              // spec | build | review | approve | needs-human | merged
  "round": 2,
  "reviews": { "security": "CHANGES", "ux": "PASS", "ui": "pending", "code": "PASS" },   // current round
  "rounds":  [ { "security": "CHANGES", "ux": "PASS", "ui": "PASS", "code": "CHANGES" } ], // finished rounds, oldest first
  "note": "",                     // one line shown on the card (blocked/escalation reason)
  "updated": "2026-10-18T20:15:00Z"
}
```

## repo.md format

Written by `repo-profiler`, edited by humans. Short; every agent reads it.

```
# Factory repo profile

## Stack
Languages, frameworks, package managers.

## Main branch
main

## Setup
Commands for a fresh worktree (install deps), or "none".

## Commands
- test: `<cmd>`
- lint: `<cmd>`
- build: `<cmd>`
(one bullet per area if the repo has several, e.g. backend / client)

## Conventions
Pointers to CLAUDE.md / AGENTS.md / style guides, plus rules not written there.

## Commits
- Prefix: rule (e.g. "issue key from feature.md Source, else factory/<id>")
- Signed: yes | no
- Merge: squash | no-ff

## Issue tracker
jira <site> <project> via Atlassian MCP | github | none

## Worktrees
`<dir>/<id>` (gitignored)

## UI paths
Where UI code lives, or "none".

## Always escalate
Paths or topics the approver must never auto-merge: auth, payments, migrations, infra, CI, prod config,
new dependencies.
```

## Dashboard

```bash
bun "$CLAUDE_PLUGIN_ROOT/dashboard/serve.ts"            # live board for the current repo: http://localhost:8765
bun "$CLAUDE_PLUGIN_ROOT/dashboard/serve.ts" example    # dummy data, to see what it looks like
```
