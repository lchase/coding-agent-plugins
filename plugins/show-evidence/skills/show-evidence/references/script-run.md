# Script run and captured transcript

Read `SKILL.md` first. Use this for a library, a pure function, or a CLI. Also use it as the HTTP or CLI fallback when Playwright, Hurl, and vhs are not available: a script that exits non-zero when the claim is false, and a saved transcript of that run.

This is smart-review's rung 4 (`ran`) when the script imports the module the app ships. Hitting a running server, browser, or CLI against a live stack is rung 5 (`reproduced`); if that is what you are doing, prefer the Playwright, Hurl, or vhs reference so the artifact shows the exchange.

## The script imports the app

Do not paste a copy of the function into the evidence script. Import the same module path the server, CLI, or package entry imports. A copy can pass while the shipped code is wrong.

```js
// evidence/order-total.mjs
import assert from 'node:assert/strict';
import { orderTotal } from '../src/pricing.mjs';

const total = orderTotal([{ price: 10, qty: 2 }]);
assert.equal(total, 20);
console.log('orderTotal([{price:10,qty:2}]) =', total);
```

Python, go test, or whatever the repo already runs is the same shape: import the package, assert, print the value the claim names so the transcript shows it.

## Capture the transcript

Redirect the run. Do not copy lines out of a scrollback buffer and call that the artifact.

```bash
mkdir -p evidence/out
set +e
node evidence/order-total.mjs > evidence/out/order-total.txt 2>&1
code=$?
set -e
printf 'exit:%s\n' "$code" >> evidence/out/order-total.txt
exit "$code"
```

PROVEN needs `exit:0` and the printed line in `order-total.txt` showing the value the claim names (`20`). An exit code with no output is NOT-EVIDENCED.

For a CLI, the script is the CLI invocation with the flags the claim is about. Print stdout and stderr to the transcript. Assert with the shell (`test`, `jq`, `grep` on a stable field) so a wrong result is a non-zero exit.

## What you commit

Commit or attach the script. Gitignore the transcript under `evidence/out/`. The summary's Re-run cell is:

```bash
node evidence/order-total.mjs
```

Assumptions: none beyond the repo's normal runtime, unless the function reads env or the clock. If it does, pin them in the script and name them in Assumptions (`SOURCE_DATE_EPOCH`, a temp dir, a fixture file).

## Do not grow a harness

One file, one command. No test framework the repo does not already use, no web UI, no server, unless the claim is about a server and you followed the HTTP references instead. smart-review's rung 4 is the same constraint: one command that fails loud when the claim is wrong.
