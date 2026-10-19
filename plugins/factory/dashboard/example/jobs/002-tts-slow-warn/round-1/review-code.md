VERDICT: CHANGES

## Findings
- [must] SpeechQueue.java:131: elapsed computed with currentTimeMillis; use nanoTime for monotonic timing.

## Checked
mvn test + checkstyle -> exit 0.
