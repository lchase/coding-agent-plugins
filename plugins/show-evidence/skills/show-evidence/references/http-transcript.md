# Hurl and .http

Read `SKILL.md` first. Read `playwright-request.md` first if the claim is HTTP.

## When test-drive is installed

Do not add a Hurl or `.http` file. test-drive's `record-api.mjs` already writes a redacted text transcript (`after.result.json`) with the request, the response, and the server log lines for each step. Follow `playwright-request.md`.

## When test-drive is not installed

Use this when a reviewer should read the proof as text, or the repo already stores `.hurl` or `.http` files. Hurl carries the assertions. A `.http` file is only the request: pair it with a captured response and a check that exits non-zero when the claim is false.

Do not put a web UI in front of the API so you can film it.

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
jsonpath "$.sku" == "WIDGET-1"
jsonpath "$.qty" == 2

GET {{API_BASE_URL}}/orders/{{order_id}}
Authorization: Bearer {{API_TOKEN}}
HTTP 200
[Asserts]
jsonpath "$.sku" == "WIDGET-1"
jsonpath "$.qty" == 2
```

Pass variables with `--variable`. Default the token to `test-token`. `--very-verbose` writes bodies, and it writes secrets: run the transcript through redaction before upload (`redaction.md`). Reset the rows the claim reads back, and note that in Assumptions.

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

`hurl --test` exits non-zero when an assertion fails. **PROVEN** needs that exit 0 and a verbose file that still shows the status and the asserted fields after redaction. If redaction removed the field the claim is about, re-run with fake data.

A repo that already uses `.http` can keep the request there. Capture the response under the gitignored output dir and assert the status in the same command that saves it. Commit or attach the request file. This is rung 5 (`reproduced`) when it hits the running app.

If `hurl` is not installed and the repo has no `.http` files, use the Playwright fallback in `playwright-request.md`.
