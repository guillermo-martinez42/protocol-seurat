package seurat.session.evict;

import java.util.List;

/**
 * Strategy for voluntary eviction under memory pressure.
 * Only ordering/scoring may vary. Filtering rules are fixed:
 * leaves only, never sketch, never cone core, never drop lower keeping upper.
 */
public interface EvictionPolicy {
    String name();

    List<EvictionAction> select(
            List<EvictionCandidate> leaves, EvictionContext ctx, int needBrushes, int needKib);
}
