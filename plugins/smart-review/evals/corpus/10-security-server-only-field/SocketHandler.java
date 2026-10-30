package example.chat;

import com.fasterxml.jackson.databind.ObjectMapper;

public class SocketHandler {
    private final ObjectMapper mapper;
    private final Orchestrator orchestrator;

    public SocketHandler(ObjectMapper mapper, Orchestrator orchestrator) {
        this.mapper = mapper;
        this.orchestrator = orchestrator;
    }

    public void handleMessage(String rawJson) throws Exception {
        MessageDto msg = mapper.readValue(rawJson, MessageDto.class);
        // debug_active is server-derived; never trust a client-supplied value.
        msg.setDebugActive(false);
        orchestrator.handle(msg);
    }
}
