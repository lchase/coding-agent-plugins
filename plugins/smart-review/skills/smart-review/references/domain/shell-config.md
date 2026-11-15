# Domain: shell and script-like config

Injected into **correctness** and **security** for shell scripts and config files that embed shell: `*.sh`, Makefile recipes, CI `run:` steps, setup yaml, Dockerfile `RUN` lines. These run unreviewed on every developer machine and CI runner, and the bugs are in the quoting and file edge cases the happy path never hits.

## → correctness

- **Overwrite vs guard.** `>` replaces a file that may already exist (tracked, user-edited, or created by an earlier step). Is clobbering intended? A guard (`[ -f f ] ||`) or an append is usually safer (`clobbers-existing-file`).
- **Append edge cases.** `echo >>` onto a file whose last line has no trailing newline glues the new text to the old line (`-T 1C` becomes `-T 1C-Dflag`). Write a leading newline or use `printf '\n%s\n'`. Build the file in the shape the consumer parses.
- **Idempotency probes.** `grep -q word file || append` matches any line containing the word, including the opposite setting (`-Dflag=false`). Anchor the probe to the exact line (`grep -qxF -- 'line'`) so a rerun neither duplicates nor skips (`non-idempotent-script`).
- **Quoting and word splitting.** Unquoted `$var` splits on spaces and globs. zsh and bash differ: zsh does not word-split an unquoted variable. Use arrays or quote, and keep `--` before values that may start with a dash.
- **Error handling.** No `set -e`/`set -o pipefail` means a failed step is ignored. A `| tail` or `| tee` returns the last command's status, hiding a failed build. Check `$?` or `PIPESTATUS` right after the command.
- **Where it runs.** Does the script also run in CI, the main checkout, or a second OS (BSD `sed -i ''` vs GNU `sed -i`, `readlink -f`, `date -d`)? Say which environments the diff assumes.
- **Cleanup and temp files.** `mktemp` plus a `trap` for removal; no fixed `/tmp/name` that two runs share.

## → security

- **Injection.** Untrusted values (branch names, PR titles, issue text, env from forks) interpolated into a command or a CI `run:` expression become shell. Pass them through env vars and quote them.
- **Secrets.** Not echoed, not set via `set -x`, not passed as command-line args visible in `ps`; CI logs mask only values registered as secrets.
- **Downloaded code.** `curl | sh` and unpinned installs; verify checksum or pin a version.
- **Permissions.** `chmod 777`, world-writable temp dirs, tokens with wider scope than the step needs.
