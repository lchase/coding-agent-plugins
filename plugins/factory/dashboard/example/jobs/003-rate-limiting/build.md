STATUS: READY

# Build: Rate limiting on manage API

## Changes
- server/filter/RateLimitFilter.java: ContainerRequestFilter, Caffeine window per account, 429 + Retry-After
- common/FeatureFlagConstants.java: AI_AGP_MANAGE_WRITE_RATE_LIMIT
- server/filter/RateLimitFilterTest.java: covers AC1 to AC5

## Acceptance criteria
- [x] AC1: RateLimitFilterTest.sixtyFirstWriteIs429
- [x] AC2: RateLimitFilterTest.otherAccountUnaffected
- [x] AC3: RateLimitFilterTest.getNeverLimited
- [x] AC4: RateLimitFilterTest.treatmentZeroDisables
- [x] AC5: RateLimitFilterTest.metricTaggedByMethodOnly

## Verification
mvn -ntp test -pl virtual-agent-fulfillment-server-quarkus -am -Dtest=RateLimitFilterTest -> exit 0
mvn -ntp checkstyle:check -pl virtual-agent-fulfillment-server-quarkus -> exit 0

## Commits
a1b2c3d factory/003-rate-limiting Rate limiting on manage API

## Round 2
- security [must] unbounded cache keyed by account: added maximumSize(100_000) and expireAfterWrite(1m)
- code [must] retry_after_seconds was a long, spec says int: changed, test updated
- code [nit] filter registered twice via @Provider and explicit registration: kept @Provider only
