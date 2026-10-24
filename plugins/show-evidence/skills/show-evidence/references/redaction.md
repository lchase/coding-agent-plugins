# Redaction

Read `SKILL.md` first. Run this before upload, and before you mark a claim PROVEN.

The script should never have seen a real secret. Use fixture values (`Bearer test-token`, `user@example.com`, `sku: WIDGET-1`) and a local or sandbox server. Redaction is the check that this held, not the plan for how credentials get into the recording.

If the app under test will only answer a real token, do not record that token. Mark the claim NOT-EVIDENCED with the reason, or point the app at a fixture authenticator and re-run. A trace you cannot show a reviewer is not proof.

## What counts as secret

Scrub these wherever they appear: headers, bodies, URLs, console logs, server logs, tape output, Hurl verbose files, Playwright traces.

- `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`
- API keys, client secrets, passwords, session ids, refresh tokens
- Bearer and Basic credentials
- JWTs (three base64url segments, the first starting with `eyJ`)
- Connection strings and URLs with a username and password
- Private keys and PEM blocks

Emails, phone numbers, and account ids that look like a real customer are the same: use fake ones in the script. A value you are unsure about is treated as secret.

## Check the artifact

Text transcripts (Hurl output, curl transcripts, `SUMMARY.md`, server logs you attach):

- Replace the secret value with `[redacted]`. Keep the header name so a reviewer can see that auth was sent.
- Search the file for `Bearer `, `eyJ`, `AKIA`, `-----BEGIN`, and the real token if you fear it was present.
- Do not leave the unredacted file next to the redacted one in the output directory. Delete it.

Playwright `trace.zip` and video are harder. A zip stores headers in plain files inside the archive.

1. Prefer a fixture token so the zip is safe as-is.
2. If a real token may be inside, do not upload the zip or the video. Unzip to a scratch dir, scan the files, and only then decide. If you find a hit, delete the zip and re-run with a fixture. Do not try to hand-edit a trace and still call it the recording of the run.
3. A screenshot of the UI can still show a secret on screen. Read the png before attaching it.

vhs output is a picture of the terminal. If the tape types a real token, the gif contains it. Keep the token off camera (`Hide` in the tape, env vars set before recording) and check a frame.

## After a bad capture

Delete the dirty artifact, fix the script so it uses fixture data, run again, and say so in Why: "first capture included a live Authorization header and was deleted; re-ran with Bearer test-token." The re-run is a harness fix, which `SKILL.md` allows you to name. Uploading the dirty file and promising to redact later is not allowed.
