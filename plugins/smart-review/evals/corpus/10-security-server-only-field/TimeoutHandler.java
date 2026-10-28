package example.chat;

/** Unchanged by the PR: builds the synthetic turn that closes an idle session. */
public class TimeoutHandler {
    private final TranscriptDao dao;

    public TimeoutHandler(TranscriptDao dao) {
        this.dao = dao;
    }

    public void onIdle(SessionContext ctx, MessageDto lastInput) {
        MessageDto timeout = lastInput != null ? new MessageDto(lastInput) : new MessageDto();
        timeout.setSessionId(ctx.sessionId());
        timeout.setAccountId(ctx.accountId());
        timeout.setText("[session timed out]");
        dao.insert(Converter.toRow(99, timeout.getSessionId(), timeout.getText()));
    }
}
