# Testdata

`synthetic-runs.jsonl` is invented. Every row has `"synthetic": true`,
`"backend": "anthropic"`, `"quick": false`, and
`"claude_version": "synthetic"`. It exists so `analyze.py` can be checked without an
API key. It is not a measurement of Claude Code or of any plugin.

Regenerate it after you change the fixture:

```bash
python3 synthetic_fixture.py
```

Do not copy the file to `results/runs.jsonl`. `analyze.py` titles a synthetic file
"SYNTHETIC summary" and refuses to mix it with real rows.

The arms below are not installable. They are labels on made-up numbers (2 tasks, 8
repeats, model `sonnet`, effort `medium`, the real Click pin as `target_commit`):

| Arm | What the numbers are for |
|---|---|
| `baseline` | Cost 1.0. Token buckets 1000 / 4000 / 200000 / 3000 (input, cache write, cache read, output). |
| `concise` | Same cost, output cut to 400. Output down, cost flat, no evidence of a cost change. |
| `cheaper` | Cost 0.5 and every bucket halved. Interval below 1, passes: a real saving. Not "tokens down, cost flat". |
| `read-cut` | Cost still 1.0, cache reads cut to 20000. Tokens down, cost flat. |
| `cache-bust` | Cost 1.5, cache writes up to 32000, cache reads down. More expensive, and the cache-write flag. |
| `noisy` | Costs swing from about 0.35 to about 1.90. The interval has to straddle 1. |
| `regress` | Cost 0.4, same tokens as baseline, `pass: false`. The label is a pass-rate drop, not a saving. |

`bin/claude` is a sentinel. `check.sh` puts it first on `PATH`. If the harness execs
Claude during `--plan`, the cost gate, or `--dry-run`, the sentinel writes a line and
the check fails.
