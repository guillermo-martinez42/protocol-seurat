package seurat.session.evict;

/** Shared numeric/policy names. No literals elsewhere. */
public final class EvictionConstants {
    public static final int HEADROOM_BRUSHES = 8;
    public static final int PRESSURE_NUM = 9;
    public static final int PRESSURE_DEN = 10;
    public static final int RETAIN_BANDS = 2;
    public static final int MAX_BANDS = 4;

    public static final String POLICY_LRU = "lru";

    private EvictionConstants() {}
}
