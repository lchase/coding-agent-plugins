# Token-savings benchmark

A paired comparison of stock Claude Code against plugins and settings that claim to
save tokens or money. The target is [pallets/click](https://github.com/pallets/click)
**8.5.0**, pinned by commit and tree hash in `pins.sh`. Click is not vendored. The first
run clones it into `.cache/` (gitignored).

This is for a talk and for anyone who wants to re-run the same matrix on their own
account, then add another plugin as a pull request. It is not a marketplace plugin and
it does not install into Claude Code by itself.

## Cost

A live run calls `claude -p` and bills an Anthropic API key. The script will not do that
unless you pass `--yes`.

The default matrix is 4 tasks, every arm under `arms/` (six today), and 5 repeats:
**120 sessions**. Each session is capped at **$5** (`--max-budget-usd`) and 60 turns.
The hard ceiling for that matrix is **$600**. That number is a cap, not a price and not
an estimate. Tasks and arms do not cost the same, and a session can stop well under the cap.

Price one session before you spend the rest:

```bash
./run_bench.sh --pilot --yes
```

That is baseline, the first task, one repeat, still capped at $5, written to
`results/pilot.jsonl`. Multiply a pilot row by 120 only as a rough upper feel for the
full matrix. The ceiling remains $600.

Without `--yes`, a paid `./run_bench.sh` prints the ceiling for the selection you asked
for and exits 2. It does not check for an API key and it does not call Claude.
`--ollama` does not use that gate: a local server is not an Anthropic bill. The two
cheaper ways to run are below.

`--plan` prints the matrix and exits 0. No key, no Claude.

`--dry-run` builds a real worktree and grades it, and does not call Claude. A bare
`--dry-run` (no `-n`, `-a`, or `-t`) shrinks to one baseline session of the first task.
Pass `-n`, `-a`, or `-t` if you want a wider dry run.

Subscription billing is a different measurement. `total_cost_usd` is list price only when
`ANTHROPIC_API_KEY` is set, and the prompt-cache TTL on an API key is 5 minutes. Do not
mix subscription runs into the same JSONL if you want the ratios to mean one thing.

## Local model (`--ollama`)

Ollama 0.14.0 and later speaks the Anthropic Messages API, which is what Claude Code
sends. That is the current recommended connection (checked 2026-10-18 against
[Ollama's Claude Code page](https://docs.ollama.com/integrations/claude-code)):

```bash
ollama serve
ollama pull qwen3-coder
./run_bench.sh --plan --ollama qwen3-coder
./run_bench.sh --ollama qwen3-coder
```

Use the name you pulled. A local Qwen around 27B is a reasonable shake-out model if that
is the tag `ollama list` shows. Ollama recommends at least a 32k context for Claude Code,
and 64k for a larger repo. Set that on the model (a Modelfile or `OLLAMA_CONTEXT_LENGTH`).
The harness does not set it for you. Click at this pin is a small tree.

For each session the harness points Claude Code at the local server and clears the API
key so a key in your shell is not sent:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:11434
ANTHROPIC_AUTH_TOKEN=ollama
ANTHROPIC_API_KEY=
ANTHROPIC_DEFAULT_SONNET_MODEL=<the --ollama name>
ANTHROPIC_DEFAULT_HAIKU_MODEL=<the --ollama name>
ANTHROPIC_DEFAULT_OPUS_MODEL=<the --ollama name>
claude --model <the --ollama name>
```

The three `ANTHROPIC_DEFAULT_*_MODEL` variables matter because Claude Code sometimes
asks for a Sonnet, Haiku, or Opus id on its own. Mapped this way, that request stays on
the local model. Official Ollama setup is the base URL, the token, the empty API key,
and `--model`. The harness adds the tier map on top of that.

Override the URL with `BENCH_OLLAMA_BASE_URL` (full URL) or `OLLAMA_HOST` (`host:port`
or a full URL). Before any live local session the harness fetches `$BASE/api/tags` and
requires the model name, or that name with `:latest`. `--plan` and `--dry-run` do not
need the server to be up.

Rows are `backend: "local"`, `model` is the Ollama name, and the file is
`results/local.jsonl`. `analyze.py` puts them in their own section. The headline there
is a paired **token** ratio. A dollar figure, including a zero, is not a cost result.

Use this mode for harness shake-out and for rough raw-token deltas (a tool-output
plugin, a terse-output plugin). Do not use it for cost or prompt-cache conclusions.
There is no Anthropic cache billing and no 5-minute TTL. The tokenizer and the agent
behavior are not Claude's.

`--ollama` does not shrink the matrix. With the six shipped arms it drops Headroom and
runs 4 tasks x 5 arms x 5 repeats = 100 sessions. That is free of API cost and expensive
in GPU time. Cut it with `--quick`, `-n`, or `-t`.

Headroom is skipped, with a message. Headroom is itself a proxy and sets
`ANTHROPIC_BASE_URL`. Stacking it on Ollama would send traffic to the wrong place, and
a custom base URL disables MCP tool search. Passing `-a` with `headroom` included is an
error, so the conflict is not a silent skip inside an explicit list. `--max-budget-usd`
is not passed. `--yes` is not required. Max turns and the wall timeout still apply.

An arm `settings.json` `env` block can override the process environment. None of the
shipped arms except Headroom set `ANTHROPIC_BASE_URL`, and Headroom does not run here.

## Quick paid preset (`--quick`)

A small real Claude run, still billed, still gated on `--yes`:

```bash
./run_bench.sh --plan --quick
./run_bench.sh --quick --yes
```

The preset is the noisy-bug task (`t2-splitopt`), the read-heavy explanation
(`t3-explain`), 2 repeats, and every arm. The model is `claude-haiku-5-5` (Haiku 5.5).
That is 2 tasks x 6 arms x 2 repeats = **24 sessions**. At the default $5 cap the hard
ceiling is **$120**. The plan prints both numbers before anything is sent.

Haiku 5.5 is the current low-priced Claude Code model that still uses tools. These two
tasks are a one-function parser bug with a large test log, and a read-and-explain. That
is in range for it. The full matrix stays on `sonnet`, so a published comparison is not
quietly a Haiku run. The short alias `haiku` is not used: Claude Code has resolved that
alias to Sonnet. If Haiku fails the grade, that is a result of this preset.

Explicit `-n`, `-m`, `-a`, or `-t` replaces that one setting and leaves the rest of the
preset. The report says the interval is wide: a quick check, not proof. Rows are
`quick: true` and land in `results/quick.jsonl`.

`--quick --ollama <model>` is the short local shake-out: same two tasks, 2 repeats, every
arm except Headroom (20 sessions), no API bill, both caveats in the report.

## What you need

- git
- Python 3.10 or newer (Click 8.5.0's floor). Debian and Ubuntu also need `python3-venv`
  so `python3 -m venv` works. `python3 -m pip` is used once, to build `.cache/tool-venv`.
- Claude Code on `PATH` for any run that calls `claude`. `ANTHROPIC_API_KEY` for a paid run. Ollama 0.14.0 or later for `--ollama` (no API key).
- `shellcheck` if you want `./check.sh`
- For the RTK, Caveman, Headroom, and Ponytail arms: those tools installed, then
  `./setup_arms.sh`. Headroom also needs a proxy you start yourself (below).

`./check.sh` needs network once, to clone Click and pip-install pytest. It does not call
Claude and it does not read an API key.

## Method

Each cell is one fresh Click checkout and one fresh `claude -p` process.

1. `fetch_target.sh` (or the first bench run) clones tag `8.5.0` at
   `8b19813f2bfca99f1018a587a8cf54fc959f2e5d` and checks the tree hash
   `2955d48825c98fd7dcbc60eb41cf18a952a2c0a3`. The annotated tag object is recorded in
   `pins.sh` and is not re-checked on the shallow clone.
2. Each arm has a private home under `.arms/<id>/`: `HOME`, `CLAUDE_CONFIG_DIR`, and the
   XDG config, data, and cache roots. Setup writes plugin state there, not into your real
   `~/.claude`.
3. Every session copies the pin into a temp directory outside this repo, applies
   `patches/<task>.patch` when that file exists, and folds the patch into the only commit.
   The clone is shallow, so the parent of 8.5.0 is not present and `git show` cannot print
   the injection as a one-line diff. `origin` is removed, the clone reflog is deleted, and copied bytecode is deleted.
   Those three record the cache path. The workdir venv imports that checkout's
   `src/click` and does not keep pip's `direct_url.json`, which would otherwise point
   back at `.cache/` inside this repo.
4. Arm order is shuffled per task and repeat (`random.Random` with a stored seed). The
   seed and the order are columns on every row.
5. The prompt is the task file. Claude is invoked as
   `claude -p --output-format json --no-session-persistence --permission-mode bypassPermissions`
   with `--model`, `--effort`, `--max-turns`, and `--max-budget-usd`. A wall clock cap
   defaults to 2700 seconds (`--wall-timeout 0` disables it; exit 124 is `timed_out`).
6. After Claude exits, `grade.sh` scores the workdir. Hidden fixtures stay in `hidden/`
   and are copied to a temp file only for that scoring step. The workdir is then deleted.
7. One JSON object is appended to the results JSONL, under a lock. `analyze.py` rewrites
   the matching `*.summary.md`.

Pytest uses Click's own `addopts` (`-m 'not stress'`) plus `-k "not echo_via_pager"`.
Those pager tests need `less` and fail on machines that do not have it. Do not override
`addopts`: that turns the stress suite back on and drops the warnings filter.

`--bare` is not used. It skips plugins, which would erase the arms under test.

## How to run

From this directory:

```bash
./run_bench.sh --plan
./setup_arms.sh baseline concise          # no API key; plugin arms need their tools
./run_bench.sh --pilot --yes              # one billed baseline session
./run_bench.sh --quick --yes              # 24 Haiku sessions, ceiling $120
./run_bench.sh --ollama qwen3-coder       # local server, no API bill
./run_bench.sh --yes                      # the default matrix, after you mean it
./analyze.py results/runs.jsonl
./analyze.py results/quick.jsonl
./analyze.py results/local.jsonl
./analyze.py results/runs.jsonl --drop-first-rep
```

Useful cuts:

```bash
./run_bench.sh --yes -a "baseline concise rtk" -t "t1-intrange t3-explain" -n 3
./run_bench.sh --yes -m sonnet -e medium --max-budget-usd 2
./run_bench.sh --dry-run                  # grader on the seeded t1 bug, no Claude
./run_bench.sh --fresh --yes              # truncate the destination JSONL first
```

`--fresh` truncates only the file this invocation writes (`results/runs.jsonl`,
`results/quick.jsonl`, `results/local.jsonl`, `results/pilot.jsonl`, or
`results/dry-run.jsonl`). Raw transcripts under `results/raw/` are not deleted.

Re-run `./setup_arms.sh <id>` after you edit that arm file. `run_bench.sh` refuses a live
arm whose `.bench-ready` stamp does not match the script hash.

Set `BENCH_RUNNER` to a public handle if you want the row to name who ran it. The harness
does not record a hostname.

### Arm setup notes

Install commands were taken from each project's docs on 2026-10-18. They live only in
`arms/<id>.sh`. Re-running setup treats "already installed" as success.

| Arm | What setup does |
|---|---|
| baseline | Writes an empty `.claude/settings.json`. |
| concise | Sets the built-in output style to `Concise`. |
| rtk | `RTK_TELEMETRY_DISABLED=1 rtk init -g --auto-patch` inside the arm home. This is the shell-output hook, not rtk-proxy and not `--hook-only`. If a newer `rtk init` offers the proxy, decline it. The binary is the Token Killer (`rtk-ai/rtk`), not the Rust Type Kit crate. `rtk gain` tells them apart. |
| caveman | `claude plugin marketplace add JuliusBrussee/caveman` and `claude plugin install caveman@caveman`. Default level, not ultra, and not the input proxy. |
| ponytail | `claude plugin marketplace add DietrichGebert/ponytail` and `claude plugin install ponytail@ponytail`. Default level, not ultra. The status band does not render in `claude -p`. The rules still load. |
| headroom | Does not start a process. Install `pip install "headroom-ai[proxy]"` (the PyPI project `headroom` is a different program) and leave `headroom proxy --port 8787` running. `arm_check` requires HTTP 200 from `/health`. The arm sets `ANTHROPIC_BASE_URL` to that proxy. A custom base URL turns off MCP tool search. This bench has no MCP servers, so that confound is small here and is not small in a session that has MCP. `--ollama` skips this arm: two proxies cannot share one base URL. |

`./setup_arms.sh` with no arguments sets up every arm. Skip the ones whose tools you do
not have, and pass the names you do: `./setup_arms.sh baseline concise`.

## How to read results

`analyze.py` pairs rows on `(task, rep)` inside a group of `(backend, model, effort, target_commit)`.
A missing `backend` counts as `anthropic`. Efforts are not pooled, and a local section is
never pooled with an Anthropic section. The headline number on an Anthropic section is the paired **cost ratio** against baseline:
arm cost divided by baseline cost on the same task and the same repeat. The interval is a
95 percent bootstrap of the median (5000 resamples, seed 0).

- The interval lies entirely below 1, and the pass rate did not drop: **real saving**.
- The interval contains 1: **no evidence** of a cost change. The point estimate is not a result.
- The interval lies entirely above 1: **more expensive**.
- Any pass-rate drop against baseline on the paired cells overrides a cheap-looking ratio.
  A cheaper run that fails the grade is not a saving.

Token totals are beside the cost on purpose.

- Tokens down, cost flat: the cut landed on cache reads. Cache reads are the cheap bucket
  on an agent bill. `analyze.py` flags this when the paired total-token median is under
  0.9 and the cost interval still contains 1.
- Output down, cost flat: a terse style can do this. Compare that arm with `concise` as
  well as with baseline. The report includes a cost ratio against `concise` when both arms
  were billed. A plugin that does not beat the free output style is not earning its install.
- Cache writes up: something rewrote the cached prefix. Cost can rise while the raw token
  total falls. That is the signature to look for in a compression proxy. The report flags
  a paired cache-write median above 1.5.

Repeat 1 in a batch often pays cache writes that later repeats read back. Shuffle spreads
that across arms. `--drop-first-rep` drops repeat 1 from the tables if you want the
warm-cache comparison on its own.

A row with a dollar cost and a failing grade still enters the ratio. You paid for it.
A row with no `total_cost_usd` does not get a fake zero. Pilot rows are counted and then
left out of the paired tables. Dry-run files are refused unless you pass `--allow-dry-run`.
A file that mixes `synthetic: true` with real rows is refused. So is a mix of dry-run and
live rows.

A local section does not use that cost rule. Its headline is the paired total-token ratio
(`fewer tokens`, `more tokens`, or `no token evidence`), and the report says so in the
section. A tiny `cost_usd` on a local row is not a real saving. Cache-write and cache-read
buckets are still printed, as raw counts, and they are not Anthropic prompt-cache accounting.

A group with `quick: true` says the interval is wide. That is a check, not proof. Two
repeats are not the five-repeat matrix.

The markdown report repeats the Anthropic decision rule at the bottom, and says that rule
does not apply to a local section.

## Results on disk

| Path | What it is |
|---|---|
| `results/runs.jsonl` | Paid matrix. One JSON object per line, schema 1. `backend` is `anthropic`. |
| `results/quick.jsonl` | `--quick` paid preset. `quick: true`. |
| `results/local.jsonl` | `--ollama`. `backend` is `local`. Not a cost measurement. |
| `results/pilot.jsonl` | `--pilot` rows. |
| `results/dry-run.jsonl` | Harness practice. `dry_run: true`. Not a measurement. |
| `results/*.summary.md` | The report `analyze.py` writes next to that JSONL. |
| `results/raw/` | Full Claude JSON for each session, including the model transcript. Gitignored. Do not publish it blindly. |

Everything under `results/` except `results/README.md` is gitignored. Share a JSONL
out of band. Schema, Claude Code version, model, effort, arm script hash, tool versions,
target commit, and timestamps are on each row so two people's files can be compared
without guessing what they ran.

`cost_usd` is whatever Claude reported as `total_cost_usd`. Token fields are
`input`, `cache_write`, `cache_read`, and `output`. `model_resolved` is the sorted
`modelUsage` keys when Claude sent them. `stderr_tail` keeps the last 400 characters
after redacting `ANTHROPIC_API_KEY` and `sk-ant-...` values. The model transcript is not
copied into the JSONL. It stays in `results/raw/`.

`runner` is `BENCH_RUNNER` or null.

## Tasks

| Id | Prompt | Patch | Grade |
|---|---|---|---|
| `t1-intrange` | Fix a failing IntRange clamp. Do not edit `tests/`. | `IntRange._clamp` returns `bound - dir` | Suite passes, and `tests/` is unchanged |
| `t2-splitopt` | A noisy failure. Find the root cause in library code. | `_split_opt` returns `opt[:1], opt[1:]` | Same. On this pin the bug fails 478 tests. |
| `t3-explain` | Do not edit source. Write `ANSWER.md` for how Click resolves a parameter. | none | `src/` untouched, and the answer names `consume_value`, `value_from_envvar`, `lookup_default`, `get_default`, `ParameterSource`. That is a floor, not a quality score. |
| `t4-pluralize` | Add `pluralize` to `click.utils` and export it. | none | `def pluralize(` in `utils.py`, the name exported from `click`, a hidden pytest file, then the suite. Existing tests must stay. |

A new file in `tasks/` is not billed until its id is listed in `TASKS` inside `pins.sh`
and `grade.sh` has a branch for it.

## Adding an arm

An arm is one file. `_*.sh` is ignored, so the template is not an arm.

```bash
cp arms/_template.sh arms/my-plugin.sh
# edit arm_summary, arm_setup, arm_check, arm_env, arm_version_commands
./setup_arms.sh my-plugin
./run_bench.sh --plan
./run_bench.sh --yes -a "baseline my-plugin" -n 3 -t "t1-intrange"
```

The id is the filename without `.sh`: lowercase letters, digits, hyphens, starting with
a letter or digit. `./setup_arms.sh` sources the file inside the arm's private home and
calls `arm_setup`. `arm_check` runs before every session. A non-zero check skips the
Claude call, records the row with `arm_check_failed`, and still grades the untouched
tree. `arm_env` may export variables for that process. Leave `ANTHROPIC_API_KEY` alone.

Keep the install command non-interactive. Put a one-line comment naming the upstream
docs you copied it from and the date you checked them. `arm_version_commands` should
print one shell command per line. Setup runs them and stores the first lines in
`.arms/manifest.json`, which the JSONL copies onto `tool_versions`.

`list_arm_ids` always prints `baseline`, then `concise`, then the rest in alphabetical
order. That is the default matrix. You do not register the arm anywhere else.

## Adding a task

1. Write `tasks/<id>.md`. That file is the entire prompt.
2. If the task starts from a broken tree, add `patches/<id>.patch` against the pinned commit.
3. Score it in `grade.sh`. Put any oracle, hidden test, or reference answer under `hidden/`.
   Do not copy those into the workdir from `make_workdir`.
4. Append the id to `TASKS` in `pins.sh`.

Confirm with `./check_graders.sh` (or `./check.sh`) that the seeded bug fails and the
reference fix passes. A task that the grader cannot fail is not a task.

## Caveats

- Same-user `bypassPermissions` can read any path the process can read. Hidden files are
  not copied into the workdir, the prompt does not name this directory, and the workdir's
  git config and venv are checked so they do not embed it. A model that already knows
  where your clone lives, or that recognizes Click and fetches 8.5.0 from GitHub, can
  still see the real sources. A separate OS user who cannot read `hidden/` is the stricter
  setup. This harness does not create that user.
- The grader is a floor. t3 does not score the explanation, only five names. t1 and t2
  accept any change that turns the suite green without editing `tests/`.
- One library, four tasks, `claude -p` with permission bypass. That is not an interactive
  session, and it is not your repo. Plugin behavior that depends on a long conversation,
  MCP servers, or the terminal UI (Ponytail's band, Caveman's statusline) is absent here.
- Plugins auto-update. Rows store `tool_versions` and `arm_script_sha256`. If you change
  an arm file, setup must be re-run or the live harness refuses the arm. Two JSONL files
  with different hashes are not the same arm.
- Headroom's `ANTHROPIC_BASE_URL` turns off MCP tool search. There is no MCP in this bench.
  `--ollama` does not run Headroom, because that arm would replace the local base URL.
- A local row can show token movement that will not survive on Claude. Different
  tokenizer, different tool habits, no Anthropic cache TTL. Read the local section as a
  shake-out.
- Global `HOME` isolation can miss a config Claude reads from outside those variables.
  That has not been proven against a live binary.
- The $5 cap and the wall timeout can cut a session short. That shows up as data
  (`timed_out`, a low `num_turns`, a failing grade), and it is still a billed row when
  Claude reported a cost.
- The first session in a cache window pays writes. Shuffle plus optional
  `--drop-first-rep` is the mitigation. It is not a guarantee that two arms saw the same
  cache state, because each arm has its own home and its own prefix.
- Publishing `results/raw/` can publish the transcript. The JSONL redacts known key
  shapes. It does not redact a secret the model echoed in some other shape, because that
  text is not stored on the row. The raw file still has it.

## What is checked without an API key

`./check.sh` runs:

- `shellcheck` on the harness, the arms, and the demos
- `analyze_test.py` against `testdata/synthetic-runs.jsonl` (invented rows, `synthetic: true`)
- the arm contract: six real arms, the template excluded, each file sets `arm_summary`
- the cost gate: `--plan`, a paid invocation without `--yes`, and `--quick` without
  `--yes` do not execute `claude` (a sentinel binary is first on `PATH`). `--plan --quick`
  is 24 sessions of `claude-haiku-5-5` with a $120 ceiling. `--plan --ollama` skips
  Headroom and does not apply a dollar cap. An explicit `-a headroom` with `--ollama`
  is an error. A closed `BENCH_OLLAMA_BASE_URL` fails the health check before `claude`
  and does not take the paid gate
- `setup_arms.sh` for baseline and concise, twice
- one `--dry-run`, which must grade the seeded t1 bug as `FAIL:suite` and write one
  Anthropic JSONL row, plus one `--dry-run --ollama` row tagged `backend: local`
- `check_graders.sh`: each seeded bug fails, the reference fix passes, edited tests fail,
  a partial t3 answer fails, hidden files are not in the workdir

The synthetic file is regenerated with `python3 synthetic_fixture.py`. Do not copy it to
`results/runs.jsonl`. The arms in that file (`cheaper`, `read-cut`, `cache-bust`, `noisy`,
`regress`) are not plugins.

GitHub Actions runs `./check.sh` on pull requests (`.github/workflows/pr-checks.yml`,
job `token-savings`). It does not run a paid bench.

## What has not been run

No paid `claude -p` session has been executed for this harness, and no live Ollama
session has either. Untested against a real Claude Code or a real local model: pilot
pricing, the full matrix, the `--quick` Haiku preset, `--ollama` end to end (the health
check is only tested against a closed port), plugin install commands for RTK, Caveman,
Headroom, and Ponytail, the Headroom proxy path, and `demos/demo_cache_expiry.sh`.
`demos/demo_rtk_output.sh` needs the `rtk` binary and is not part of `./check.sh`.

## Demos

Talk props, not part of the matrix:

- `demos/demo_context.md`: a two-minute `/context` and `/usage` note. No API script.
- `demos/demo_rtk_output.sh`: pytest byte counts with and without `rtk` on the noisy bug.
  No Claude. Needs `rtk` on `PATH`.
- `demos/demo_cache_expiry.sh`: three Claude calls and a sleep past the 5-minute TTL.
  Requires `--yes` and an API key. It spends money. Pre-record it.

## Layout

```
pins.sh                 # Click pin, default caps, the task list
fetch_target.sh         # clone or verify .cache/click
lib.sh                  # workdir, arm discovery, shuffle
arms/<id>.sh            # one arm; arms/_template.sh is not discovered
setup_arms.sh           # private home + arm_setup
run_bench.sh            # the matrix
grade.sh                # PASS or FAIL:... ; exit 0 either way
benchlib.py             # JSONL record, redaction, bootstrap, report
analyze.py              # report CLI
record_run.py           # one-row append used by run_bench.sh
tasks/                  # prompts
patches/                # seeded bugs for t1 and t2
hidden/                 # grader-only tests and reference answers
results/README.md       # convention; runs are gitignored
testdata/               # synthetic JSONL and the claude sentinel
check.sh                # offline checks
demos/                  # talk props
```
