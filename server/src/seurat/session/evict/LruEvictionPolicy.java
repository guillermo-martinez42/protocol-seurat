package seurat.session.evict;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Interim default. Order from §5.2.3: outside cone, finest stratum,
 * farthest from gaze, least recently painted. Replaceable via {@link EvictionPolicies}.
 */
public final class LruEvictionPolicy implements EvictionPolicy {
    private static final Comparator<EvictionCandidate> ORDER = Comparator
            .comparing(EvictionCandidate::inCone)
            .thenComparing(Comparator.comparingInt(EvictionCandidate::stratum).reversed())
            .thenComparing(Comparator.comparingLong(EvictionCandidate::distanceSq).reversed())
            .thenComparingLong(EvictionCandidate::lastPaintedNs);

    @Override
    public String name() {
        return EvictionConstants.POLICY_LRU;
    }

    @Override
    public List<EvictionAction> select(
            List<EvictionCandidate> leaves, EvictionContext ctx, int needBrushes, int needKib) {
        List<EvictionCandidate> evictable = leaves.stream()
                .filter(c -> !c.isSketch() && !c.inConeCore() && !c.hasOwnedChildren())
                .sorted(ORDER)
                .toList();
        List<EvictionAction> out = new ArrayList<>();
        int freedBrushes = 0;
        int freedKib = 0;
        for (EvictionCandidate c : evictable) {
            if (freedBrushes >= needBrushes && freedKib >= needKib) {
                break;
            }
            boolean upperOnly = c.bandsTo() > EvictionConstants.RETAIN_BANDS
                    && c.bandsFrom() <= EvictionConstants.RETAIN_BANDS;
            out.add(upperOnly ? EvictionAction.dropUpper(c.brushId()) : EvictionAction.dropWhole(c.brushId()));
            freedBrushes++;
            freedKib += upperOnly ? c.bytesKib() / EvictionConstants.RETAIN_BANDS : c.bytesKib();
        }
        return List.copyOf(out);
    }
}
