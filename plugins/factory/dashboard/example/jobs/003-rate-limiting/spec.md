# Rate limiting on manage API

## Goal
Protect the management endpoints from runaway clients. Writes from one account are capped at 60 per minute; the caller gets a 429 with a hint on when to retry.

## Scope
- In: POST/PUT/DELETE under `/multi-agent/manage/**` in `virtual-agent-fulfillment-server-quarkus`
- Out: read endpoints, WebSocket traffic, per-agent-system limits

## Design
- New `RateLimitFilter` (JAX-RS `ContainerRequestFilter`) in `com.talkdesk.ai.va.server.filter`, keyed by account id from the JWT.
- Sliding window counter in an in-memory `Caffeine` cache (already a dependency), TTL 1 minute.
- Limit read from feature flag `AI_AGP_MANAGE_WRITE_RATE_LIMIT` via `getFeatureTreatment(accountId, flag, "60")`; constant in `FeatureFlagConstants`.
- Response body `{ "error": "rate_limited", "retry_after_seconds": <int> }`, plus `Retry-After` header.

## Acceptance criteria
- [ ] AC1: 61st write from the same account within 60s returns 429 with `retry_after_seconds`
- [ ] AC2: writes from a different account are unaffected
- [ ] AC3: GET requests are never limited
- [ ] AC4: flag treatment `0` disables the filter
- [ ] AC5: metric `manage.rate_limited` increments with tag `method` only (no account id tag)

## Verify
mvn -ntp test -pl virtual-agent-fulfillment-server-quarkus -am -Dtest=RateLimitFilterTest
mvn -ntp checkstyle:check -pl virtual-agent-fulfillment-server-quarkus
