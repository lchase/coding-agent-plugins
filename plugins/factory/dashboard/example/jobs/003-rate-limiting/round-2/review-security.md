VERDICT: CHANGES

## Findings
- [must] server/filter/RateLimitFilter.java:40: account id is read from the `X-Account-Id` header as a fallback when the JWT claim is missing. A caller can spoof it to escape the limit. Fix: drop the header fallback; reject with 401 when the claim is absent.

## Checked
Round-1 fix verified (maximumSize present). Re-read filter in full.
