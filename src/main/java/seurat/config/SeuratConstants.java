package seurat.config;

/** Central numbers from the spec. No literals elsewhere. */
public final class SeuratConstants {
    private SeuratConstants() {}

    public static final int HTTP_PORT = 8080;
    public static final long LEASE_S = 120;
    public static final long SKEW_MS = 1000;
    public static final long HEARTBEAT_S = 15;
    public static final int MAX_IN_FLIGHT = 12;
    public static final int GLOBAL_SLOTS = 512;
    public static final long CODEL_TARGET_NS = 25_000_000L;
    public static final long CODEL_TICK_MS = 250;
    public static final int FRAME_MAX = 64 * 1024;
    public static final int DATAGRAM_MAX = 1200;
    public static final int TOKEN_BYTES = 32;
    public static final long TOKEN_TTL_S = 120;
    public static final int BRUSH_SIDE = 256;
    public static final long SCRAPE_TIMEOUT_S = 10;
    public static final long RENEW_S = 60;
    public static final long AUDIT_S = 60;
    public static final long AUDIT_EVERY_N = 500;
    public static final long IDLE_S = 60;
    public static final long STALL_S = 30;
    public static final int GAZE_PER_S = 20;
    public static final int GAZE_BURST = 40;
    public static final int RECEIPT_EVERY_MS = 100;
    public static final int RECEIPT_EVERY_N = 8;
    public static final int QUEUE_MAX = 256;
    public static final int SEED_STRATUM = 10;
    public static final int SKETCH_MIN = 7;
}
