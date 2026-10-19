VERDICT: CHANGES

## Findings
- [must] server/filter/RateLimitFilter.java:31: Caffeine cache has no maximumSize; an attacker rotating account ids grows it without bound. Fix: `.maximumSize(100_000).expireAfterWrite(Duration.ofMinutes(1))`.
- [nit] server/filter/RateLimitFilter.java:58: log line includes full request path; fine, but keep account id out of the metric tag (it is, good).

## Checked
Diff main...HEAD, filter + test in full, FeatureFlagConstants.
