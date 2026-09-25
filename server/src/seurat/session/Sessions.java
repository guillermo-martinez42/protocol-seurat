package seurat.session;

import java.security.SecureRandom;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/** Session registry: live sessions, single-use tokens, resume graveyard. */
public final class Sessions {
    private final AtomicLong next = new AtomicLong(1);
    private final Map<Long, Session> live = new ConcurrentHashMap<>();
    private final Map<String, Token> tokens = new ConcurrentHashMap<>();
    private final Map<Long, Grave> graves = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    public record Token(String principal, String role, long memMib, long expiresMs) {}
    public record Grave(Session session, long expiresNs) {}

    public long reserveId() {
        return next.getAndIncrement();
    }

    public byte[] newTicket() {
        byte[] f = new byte[32];
        random.nextBytes(f);
        return f;
    }

    public String issueToken(String principal, String role, long memMib, long ttlMs) {
        byte[] t = new byte[32];
        random.nextBytes(t);
        String hex = Hex.hex(t);
        tokens.put(hex, new Token(principal, role, memMib, System.currentTimeMillis() + ttlMs));
        return hex;
    }

    public Token consumeToken(String hex) {
        Token t = tokens.remove(hex);
        if (t == null || t.expiresMs() < System.currentTimeMillis()) {
            return null;
        }
        return t;
    }

    public void add(Session session) {
        live.put(session.id(), session);
    }

    public Session find(long id) {
        return live.get(id);
    }

    public java.util.Collection<Session> all() {
        return live.values();
    }

    public void retire(Session session, long deltaNs) {
        live.remove(session.id());
        graves.put(session.id(), new Grave(session, System.nanoTime() + deltaNs));
    }

    public Grave recover(long id) {
        Grave t = graves.get(id);
        if (t == null || t.expiresNs() < System.nanoTime()) {
            graves.remove(id);
            return null;
        }
        graves.remove(id);
        return t;
    }
}
