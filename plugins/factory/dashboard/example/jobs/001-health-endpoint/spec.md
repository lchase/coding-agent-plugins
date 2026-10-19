# Agent system health endpoint

## Goal
Quick liveness check per agent system for the UI.

## Acceptance criteria
- [ ] AC1: 200 with status ok when system has at least one agent
- [ ] AC2: status degraded when zero agents
- [ ] AC3: 404 for unknown id

## Verify
mvn -ntp test -pl virtual-agent-fulfillment-server-quarkus -am -Dtest=AgentSystemHealthTest
