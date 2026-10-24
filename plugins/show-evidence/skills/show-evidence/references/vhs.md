# vhs (terminal recording)

Read `SKILL.md` first. [vhs](https://github.com/charmbracelet/vhs) (charmbracelet) plays a tape in a terminal and writes a gif or mp4.

Use it for a CLI claim, or for an HTTP claim where the user asked to watch the terminal. The tape is the replay script. The gif is the picture. The gif is not the pass/fail signal: vhs exits 0 when it finishes rendering, including when curl printed an error. Prove the claim with a script that exits non-zero on a bad result, and record that same script.

If `vhs` is not installed, skip the picture and follow `script-run.md` for the same commands. Do not block the claim on a gif.

## Tape

`evidence/orders.tape`. vhs has no comment syntax, so the note lives here: `Hide` still runs the exports, and it keeps the fixture token off the gif.

```tape
Output evidence/out/orders.gif

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 700
Set Padding 16
Set TypingSpeed 40ms

Hide
Type "export API_BASE_URL=http://127.0.0.1:3000" Enter
Type "export API_TOKEN=test-token" Enter
Show

Type "bash evidence/orders.sh" Enter
Sleep 2s
```

`evidence/orders.sh` is the proof. It uses the same fake token and it fails the process when the claim is false:

```bash
#!/usr/bin/env bash
# evidence/orders.sh
set -euo pipefail
base="${API_BASE_URL:?}"
token="${API_TOKEN:?}"

body=$(curl -sS -w '\n%{http_code}' -X POST "$base/orders" \
  -H "authorization: Bearer $token" \
  -H 'content-type: application/json' \
  -d '{"sku":"WIDGET-1","qty":2}')
code=$(printf '%s' "$body" | tail -n 1)
json=$(printf '%s' "$body" | sed '$d')
printf '%s\n' "$json"
test "$code" = "201"
python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("sku")=="WIDGET-1" and d.get("qty")==2, d' <<<"$json"
```

Parse the body. A substring check can pass on an error payload that merely contains the field name. Keep the script the source of truth. The tape only plays it. The proof run and the tape are two executions: reset the seed first if a second POST would fail the claim.

## Run

```bash
mkdir -p evidence/out
set +e
bash evidence/orders.sh > evidence/out/orders.txt 2>&1
code=$?
set -e
printf 'exit:%s\n' "$code" >> evidence/out/orders.txt
vhs evidence/orders.tape   # picture only; status stays $code
exit "$code"
```

Status comes from `orders.sh`, not from `vhs`. PROVEN needs `exit:0` and a transcript or gif frame that shows the 201 body. If the script failed, keep `orders.txt` and mark FAILED even when the gif looks tidy.

## Re-run

```bash
API_BASE_URL=http://127.0.0.1:3000 API_TOKEN=test-token bash evidence/orders.sh
vhs evidence/orders.tape
```

Write the seed (empty orders table, local server) in Assumptions. The tape and the shell script are what you commit or attach. `evidence/out/orders.gif` and `orders.txt` stay gitignored.

For a library or a CLI that does not need a picture, skip vhs and use `script-run.md` only.
