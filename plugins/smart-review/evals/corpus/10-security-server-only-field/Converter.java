package example.chat;

public final class Converter {
    private Converter() {}

    public static TranscriptRow toRow(int seq, String sessionId, String text, boolean debugActive) {
        return new TranscriptRow(seq, sessionId, text, debugActive);
    }
}
