# Lens: security

**Owns:** can this change be abused. Think in terms of untrusted input reaching a dangerous sink, and of trust boundaries the diff crosses. Report both **exploitability** (how reachable is it) and **impact** (what does an attacker get) — that pairing drives severity.

## Trace tainted input

The core move: identify every source of attacker-controlled data (request params/body/headers, query strings, uploaded files, external API responses, message payloads, env in some contexts) and follow it to every sink. A finding is strongest when you can name the source, the path, and the sink.

## Check

- **Injection.** Untrusted data concatenated into: SQL (`sql-injection` — use parameterized queries), shell commands (`command-injection`), HTML/DOM (`xss`), a filesystem path (`path-traversal`), an LDAP/NoSQL/template expression. The fix is almost always parameterization or context-correct escaping, never manual sanitization.
- **AuthZ.** Does every changed endpoint/action check that *this* user may act on *this* resource? Object-level authorization is the most common gap — the code checks you are logged in but not that the record is yours (`authz-gap`, IDOR).
- **AuthN / sessions.** Token validation, expiry, signature checks; session fixation; auth logic that fails open (`authn-gap`).
- **Secrets.** API keys, passwords, tokens, private keys committed to source or logged (`secret-in-code`). If one is present, the finding is P0 *and* the secret must be rotated, not just removed.
- **SSRF.** User-controlled URLs fetched server-side without allow-listing (`ssrf`) — especially dangerous in cloud metadata range.
- **Unsafe deserialization.** Untrusted input into a deserializer that can instantiate arbitrary types or run code (`unsafe-deserialization`).
- **Server-only fields.** A field the server derives (a role, a tenant, a debug or trust flag) must not be settable by whoever sends the payload. Use the context pack's ingress list: every deserializer of that type (websocket, HTTP, queue consumer, test API) either drops the field or overwrites it before anything reads, persists, or logs it. A reset at one handler while another ingress accepts the field is `ingress-gap`. Check the window before the overwrite too: error paths and early exits that copy the message before the server sets the field.
- **Data from a failed check.** After an ownership, tenant, or account check fails, nothing from the rejected object (its flags, settings, ids) may flow into the response, a stored row, an event, or a log. Stamping a value from another tenant's context onto the error turn is `failed-check-data-use`.
- **Open redirect**, missing output encoding, missing CSRF protection on state-changing routes, over-permissive CORS, sensitive data in URLs or logs.
- **Crypto misuse.** Home-rolled crypto, ECB mode, static IVs, weak/absent hashing for passwords (use a slow KDF), `Math.random()` for tokens.

## Negative space

- Is there a trust boundary this diff crosses that has **no** check on either side — not "the check is weak" but "no one wrote it," because both sides assumed the other validates?
- Did a new endpoint/field/action get added without a corresponding authz rule, because the reviewer's eye follows the code that changed and there's nothing to see where a check is simply absent?
- Does an old, already-fixed vulnerability class reappear because the diff bypasses the shared helper that used to guarantee it (a new raw query next to a codebase that otherwise always goes through a query builder)?

## Bias

When unsure whether something is exploitable, flag it with your uncertainty in `confidence` and the reachability in `why`, rather than staying silent — under-reporting security is costlier than a false positive here. Recommend established libraries over hand-rolled security primitives.

## Output

Canonical schema, `lens: security`. `why` must state exploitability + impact; `proposed_move` names the specific mitigation.
