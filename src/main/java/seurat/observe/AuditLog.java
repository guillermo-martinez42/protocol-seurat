package seurat.observe;

import java.time.Instant;
import java.util.concurrent.ConcurrentLinkedQueue;

/** Operator alerts: CRC failures, budget hits, audit mismatches. */
public final class AuditLog {
    private static final ConcurrentLinkedQueue<String> QUEUE = new ConcurrentLinkedQueue<>();

    private AuditLog() {}

    public static void alert(String msg) {
        QUEUE.add(Instant.now() + " ALERT " + msg);
        Log.warn("audit", msg);
    }

    public static void info(String msg) {
        QUEUE.add(Instant.now() + " INFO " + msg);
        Log.info("audit", msg);
    }

    public static String[] dump() {
        return QUEUE.toArray(new String[0]);
    }
}
