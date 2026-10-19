# Warn on slow TTS synthesis

## Goal
Surface slow text-to-speech calls in logs so on-call can correlate user-reported lag with a provider.

## Scope
- In: `multi-agent-stream` TTS providers (Microsoft, ElevenLabs)
- Out: metrics dashboards, alerting

## Design
- Wrap `synthesisAudio` timing in `SpeechQueue`; threshold from `AI_AGENT_TTS_SLOW_WARN_SECONDS` treatment (default `5`).
- `log.warn("slow TTS provider={} sessionId={} ms={}")`.

## Acceptance criteria
- [ ] AC1: synthesis over threshold logs one warn with session id and provider
- [ ] AC2: synthesis under threshold logs nothing at warn
- [ ] AC3: treatment overrides the 5s default

## Verify
mvn -ntp test -pl virtual-agent-fulfilment-multi-agent/multi-agent-stream -am -Dtest=SpeechQueueSlowWarnTest
mvn -ntp checkstyle:check -pl virtual-agent-fulfilment-multi-agent/multi-agent-stream
