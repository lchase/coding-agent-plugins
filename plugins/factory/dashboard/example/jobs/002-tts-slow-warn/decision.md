ESCALATE

## Reason
All reviews pass, but the change edits the shared session logging pattern in application.properties to add the provider MDC key. Production log config is on the escalate list; a human should confirm the log pipeline accepts the new field.

## Checked
- status clean, 2 commits ahead of main
- round 2: security PASS, ux PASS, ui PASS, code PASS
- ran: mvn -ntp test -pl .../multi-agent-stream -Dtest=SpeechQueueSlowWarnTest -> exit 0
