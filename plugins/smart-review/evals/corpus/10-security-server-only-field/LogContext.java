package example.chat;

import java.util.HashMap;
import java.util.Map;

/** Unchanged by the PR. Fields left null are omitted, so an outer scope's value survives. */
public record LogContext(String sessionId, Boolean debugActive) {
    public Map<String, String> asMdc() {
        Map<String, String> mdc = new HashMap<>();
        mdc.put("sessionId", sessionId);
        if (debugActive != null) {
            mdc.put("debugActive", debugActive.toString());
        }
        return mdc;
    }
}
