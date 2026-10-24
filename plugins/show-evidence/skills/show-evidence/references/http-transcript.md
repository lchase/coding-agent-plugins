# Hurl and .http

Read `SKILL.md` first. Use this when the HTTP proof should be a text file a reviewer can read without a trace viewer, or when the repo already stores `.hurl` or `.http` requests.

Hurl carries the assertions in the file. A `.http` file is the request document; on its own it does not check anything. Prefer Hurl. Use `.http` when the repo already speaks it, and pair it with a captured response plus a check that exits non-zero when the claim is false.

Do not put a web UI in front of the API so you can film it. The transcript is the evidence.

## Hurl

```hurl
# evidence/orders.hurl
POST {{API_BASE_URL}}/orders
Authorization: Bearer {{API_TOKEN}}
Content-Type: application/json
{
  "sku": "WIDGET-1",
  "qty": 2
}
HTTP 201
[Captures]
order_id: jsonpath "$.id"
[Asserts]
jsonpath "$.id" exists
jsonpath "$.sku" == "WIDGET-1"
jsonpath "$.qty" == 2

GET {{API_BASE_URL}}/orders/{{order_id}}
Authorization: Bearer {{API_TOKEN}}
HTTP 200
[Asserts]
jsonpath "$.sku" == "WIDGET-1"
jsonpath "$.qty" == 2
```

`{{API_BASE_URL}}` and `{{API_TOKEN}}` are Hurl variables. Pass them with `--variable`. Default the token to a fixture (`test-token`), not a real secret. `--very-verbose` writes the bodies a human should see, and it writes secrets too. Redact the output file before upload (`redaction.md`).

## Run

```bash
mkdir -p evidence/out
set +e
hurl --test --very-verbose \
  --variable API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}" \
  --variable API_TOKEN="${API_TOKEN:-test-token}" \
  evidence/orders.hurl > evidence/out/orders.hurl.out
code=$?
set -e
printf 'exit:%s\n' "$code" >> evidence/out/orders.hurl.out
exit "$code"
```

`hurl --test` exits non-zero when an assertion fails. That exit, plus a verbose file that still shows the status and the asserted fields after redaction, is PROVEN. If redaction removed the field the claim is about, re-run with fake data. Do not call the gutted file PROVEN.

Reset the orders table (or whatever the claim reads back) before the run, and note that in Assumptions. Otherwise a second GET can pass for a row this run did not create.

## .http

When the repo already has REST Client or JetBrains HTTP files:

```http
# evidence/orders.http
@base = http://127.0.0.1:3000
@token = test-token

### create order
POST {{base}}/orders
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "sku": "WIDGET-1",
  "qty": 2
}
```

Capture the response next to it (`evidence/out/orders.response.json`) with curl or the client's save, and assert in a few lines that share the claim:

```bash
code=$(curl -sS -o evidence/out/orders.response.json -w '%{http_code}' \
  -X POST http://127.0.0.1:3000/orders \
  -H 'authorization: Bearer test-token' \
  -H 'content-type: application/json' \
  -d '{"sku":"WIDGET-1","qty":2}')
test "$code" = "201"
```

Commit or attach `orders.http` (and the Hurl file if you have one). Keep `*.response.json` and `*.hurl.out` under the gitignored output dir.

## Re-run

```bash
hurl --test \
  --variable API_BASE_URL=http://127.0.0.1:3000 \
  --variable API_TOKEN=test-token \
  evidence/orders.hurl
```

This is rung 5 (`reproduced`) when it hits the running app.

If `hurl` is not installed and the repo has no `.http` habit, switch to `playwright-request.md` for the same claim.
