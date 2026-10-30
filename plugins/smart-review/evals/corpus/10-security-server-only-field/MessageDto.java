package example.chat;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

public class MessageDto {
    @JsonProperty("session_id")
    private String sessionId;

    @JsonProperty("account_id")
    private String accountId;

    private String text;

    /** Server-derived: true when the session runs with mocked tools. Omitted from JSON while false. */
    @JsonProperty("debug_active")
    @JsonInclude(JsonInclude.Include.NON_DEFAULT)
    private boolean debugActive;

    public MessageDto() {}

    public MessageDto(MessageDto other) {
        this.sessionId = other.sessionId;
        this.accountId = other.accountId;
        this.text = other.text;
        this.debugActive = other.debugActive;
    }

    public String getSessionId() { return sessionId; }
    public String getAccountId() { return accountId; }
    public String getText() { return text; }
    public void setText(String text) { this.text = text; }
    public void setSessionId(String sessionId) { this.sessionId = sessionId; }
    public void setAccountId(String accountId) { this.accountId = accountId; }
    public boolean isDebugActive() { return debugActive; }
    public void setDebugActive(boolean debugActive) { this.debugActive = debugActive; }
}
