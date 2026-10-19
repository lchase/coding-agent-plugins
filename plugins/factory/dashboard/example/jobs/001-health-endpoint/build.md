STATUS: READY

# Build: Agent system health endpoint

## Changes
- AgentSystemHealthResource.java: new endpoint
- AgentSystemHealthTest.java: AC1 to AC3

## Acceptance criteria
- [x] AC1
- [x] AC2
- [x] AC3

## Verification
mvn -ntp test ... -> exit 0

## Commits
4c3b2a1 factory/001-health-endpoint Agent system health endpoint
