STATUS: READY

# Build: Warn on slow TTS synthesis

## Changes
- multi-agent-stream/.../SpeechQueue.java: timing + warn
- FeatureFlagConstants.java: AI_AGENT_TTS_SLOW_WARN_SECONDS
- SpeechQueueSlowWarnTest.java: AC1 to AC3

## Acceptance criteria
- [x] AC1: SpeechQueueSlowWarnTest.warnsOverThreshold
- [x] AC2: SpeechQueueSlowWarnTest.silentUnderThreshold
- [x] AC3: SpeechQueueSlowWarnTest.treatmentOverridesDefault

## Verification
mvn -ntp test ... -> exit 0
mvn -ntp checkstyle:check ... -> exit 0

## Commits
9f8e7d6 factory/002-tts-slow-warn Warn on slow TTS synthesis

## Round 2
- security [must] warn line included the synthesized text: removed, logs length only
- code [must] timer used wall clock: switched to System.nanoTime
