# Redaction

Read `SKILL.md` first. Run this before upload, and before you mark a claim PROVEN.

Use fixture values (`Bearer test-token`, `user@example.com`, `sku: WIDGET-1`) and a local or sandbox server. If the app will only answer a real token, do not record that token. Mark the claim **NOT-EVIDENCED**, or point the app at a fixture authenticator and re-run. A file you cannot show a reviewer is not proof.

## When test-drive is installed

HTTP transcripts go through test-drive's `scripts/record-api.mjs`, which redacts the stored `after.result.json` with `scripts/redact.mjs` before writing it. That scrub covers authorization, cookie, and proxy-authorization headers, bearer and basic credentials, JWTs, sensitive names (token, secret, password, api key, session, credential, and similar), and userinfo in URLs. Assertions ran on the raw values. The transcript is what you attach.

Add scenario `redact.keys` or `redact.patterns` for an app-specific field. Do not write a second scrub for those cases.

`after.server.log` is raw. Do not attach it.

`redact.mjs` is best-effort. An unquoted `key=two words` leaves the second word. Quote the value, or add a `redact.patterns` entry. For a text file that record-api did not write (a Hurl verbose log, a curl transcript), import `makeRedactor` from that same `scripts/redact.mjs` and run `text()` over the file. Delete the unredacted copy. Do not reimplement the scrub.

## What that scrub does not cover

Keep these. They are outside `redact.mjs`.

- Emails, phone numbers, and customer account ids. Put fake ones in the script. recording-mode can mask some of these on a Claude Code screen. It does not edit the files you attach.
- PEM blocks (`-----BEGIN`) and AWS access key ids (`AKIA`), unless they already sit under a sensitive key. Search the text artifact for both before upload.
- Playwright `trace.zip`, video, and screenshots. The zip stores headers as plain files inside the archive. Prefer a fixture token so the zip is safe as-is. If a real token may be inside, do not upload the zip or the video. Do not hand-edit the zip and still call it the recording. Read the png before attaching it.
- vhs output. The gif is a picture of the terminal. Keep the token off camera (set it with `Env` in the tape, not typed commands, since `Hide` does not hide them) and look at a frame. If that recording will capture an agent session, turn recording-mode on first (`vhs.md`).

## After a bad capture

Delete the dirty artifact, fix the script so it uses fixture data, run again, and say so in Why: "first capture included a live Authorization header and was deleted; re-ran with Bearer test-token." That re-run is a harness fix, which `SKILL.md` allows you to name. Uploading the dirty file and promising to redact later is not allowed.
