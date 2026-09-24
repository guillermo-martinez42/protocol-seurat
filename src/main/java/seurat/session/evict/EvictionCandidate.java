package seurat.session.evict;

/**
 * Leaf-only view of an owned brush.
 * Invariants (enforced by caller, validated by server):
 * sketch and cone-core are never evictable, leaves have no owned children.
 */
public record EvictionCandidate(
        long brushId,
        int stratum,
        int bytesKib,
        long distanceSq,
        long lastPaintedNs,
        boolean inCone,
        boolean inConeCore,
        boolean isSketch,
        boolean hasOwnedChildren,
        int bandsFrom,
        int bandsTo) {}
