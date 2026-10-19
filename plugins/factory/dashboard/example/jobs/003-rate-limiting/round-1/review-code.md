VERDICT: CHANGES

## Findings
- [must] server/filter/RateLimitFilter.java:72: `retry_after_seconds` serialised as long, spec and AC1 say int. Fix: compute as int, update test assertion.
- [nit] RateLimitFilter registered via @Provider AND in RestApplication#getClasses; one is enough.

## Checked
mvn -ntp test -Dtest=RateLimitFilterTest -> exit 0; checkstyle -> exit 0; read filter, test, constants.
