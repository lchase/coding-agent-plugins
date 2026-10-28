package example.chat;

import com.fasterxml.jackson.databind.ObjectMapper;

/** Unchanged by the PR: inbound dispatch channel, fed by other services and partner integrations. */
public class QueueConsumer {
    private final ObjectMapper mapper;
    private final Orchestrator orchestrator;
    private final TranscriptDao dao;

    public QueueConsumer(ObjectMapper mapper, Orchestrator orchestrator, TranscriptDao dao) {
        this.mapper = mapper;
        this.orchestrator = orchestrator;
        this.dao = dao;
    }

    public void onRecord(String payload) throws Exception {
        MessageDto msg = mapper.readValue(payload, MessageDto.class);
        if (msg.getText() == null || msg.getText().isBlank()) {
            // Ignored messages are still stored for the transcript.
            dao.insert(Converter.toRow(0, msg.getSessionId(), msg.getText()));
            return;
        }
        orchestrator.handle(msg);
    }
}
