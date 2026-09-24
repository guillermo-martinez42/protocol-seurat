package seurat.session.evict;

/**
 * One voluntary release. Wire-compatible with {@code SOLTAR LRU}:
 * the scoring function is pluggable, the wire motive stays stable.
 */
public record EvictionAction(long brushId, boolean dropUpperOnly) {
    public static EvictionAction dropWhole(long brushId) {
        return new EvictionAction(brushId, false);
    }

    public static EvictionAction dropUpper(long brushId) {
        return new EvictionAction(brushId, true);
    }
}
