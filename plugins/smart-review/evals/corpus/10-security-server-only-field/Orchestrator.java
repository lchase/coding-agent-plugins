package example.chat;

import org.slf4j.MDC;

public class Orchestrator {
    private final SessionStore sessions;
    private final TranscriptDao dao;

    public Orchestrator(SessionStore sessions, TranscriptDao dao) {
        this.sessions = sessions;
        this.dao = dao;
    }

    public void handle(MessageDto msg) {
        SessionContext ctx = sessions.load(msg.getSessionId());
        if (ctx == null) {
            respondError(msg, "unknown session");
            return;
        }
        if (!ctx.accountId().equals(msg.getAccountId())) {
            msg.setDebugActive(ctx.debugOptions().isActive());
            respondError(msg, "account mismatch");
            return;
        }
        msg.setDebugActive(ctx.debugOptions().isActive());
        ExecutionContext exec = buildExecutionContext(msg);
        dao.insert(Converter.toRow(1, msg.getSessionId(), msg.getText(), msg.isDebugActive()));
        exec.run();
    }

    ExecutionContext buildExecutionContext(MessageDto msg) {
        SessionContext latest = sessions.reload(msg.getSessionId());
        msg.setDebugActive(latest.debugOptions().isActive());
        return new ExecutionContext(latest, msg);
    }

    private void respondError(MessageDto msg, String reason) {
        MessageDto error = new MessageDto(msg);
        error.setText("error: " + reason);
        MDC.setContextMap(new LogContext(msg.getSessionId(), msg.isDebugActive()).asMdc());
        dao.insert(Converter.toRow(2, error.getSessionId(), error.getText(), error.isDebugActive()));
    }
}
