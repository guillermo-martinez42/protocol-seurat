package seurat.session;

import seurat.kit.TestKit;

/** Sessions: single-use tokens, live registry, resume graveyard. */
public final class SessionsTest {
    public static void main(String[] args) {
        tokenSingleUse();
        gazeBucket();
        graveyard();
        System.out.println("SessionsTest OK");
    }

    private static void tokenSingleUse() {
        Sessions sessions = new Sessions();
        String hex = sessions.issueToken("anonimo", "anonimo", 128, 120_000);
        TestKit.check(hex.length() == 64, "32B hex token");
        Sessions.Token first = sessions.consumeToken(hex);
        TestKit.check(first != null && first.memMib() == 128, "consume once");
        TestKit.check(sessions.consumeToken(hex) == null, "single use");
        TestKit.check(sessions.consumeToken("zz") == null, "unknown rejected");
    }

    private static void gazeBucket() {
        Sessions sessions = new Sessions();
        Session session = new Session(1, "p", "anonimo", 128, 0, null, new byte[32]);
        sessions.add(session);
        TestKit.check(sessions.find(1) == session, "registry");
        int allowed = 0;
        for (int i = 0; i < 60; i++) {
            if (session.takeGaze()) {
                allowed++;
            }
        }
        TestKit.check(allowed == 40, "burst 40 coalesces, got " + allowed);
    }

    private static void graveyard() {
        Sessions sessions = new Sessions();
        Session session = new Session(9, "p", "anonimo", 128, 0, null, new byte[32]);
        sessions.add(session);
        sessions.retire(session, 60L * 1_000_000_000L);
        TestKit.check(sessions.find(9) == null, "dead leaves registry");
        Sessions.Grave grave = sessions.recover(9);
        TestKit.check(grave != null && grave.session() == session, "book survives");
        TestKit.check(sessions.recover(9) == null, "recover is single-shot");
    }
}
