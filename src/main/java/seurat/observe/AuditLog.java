package seurat.observe;

import java.time.Instant;
import java.util.concurrent.ConcurrentLinkedQueue;

/** Operator alerts: CRC failures, budget hits, audit mismatches. */
public final class AuditLog {
    private static final ConcurrentLinkedQueue<String> QUEUE = new ConcurrentLinkedQueue<>();

    private AuditLog() {}

    public static void alert(String msg) {
        String line = Instant.now() + " ALERT " + msg;
        QUEUE.add(line);
        System.err.println(line);
    }

    public static void info(String msg) {
        QUEUE.add(Instant.now() + " INFO " + msg);
    }

    public static String[] dump() {
        return QUEUE.toArray(new String[0]);
    }
}
