package seurat.session.evict;

import java.util.List;

/** JDK-only checks. Run with `java -ea`. Each check <300 LoC total. */
public final class LruEvictionPolicyTest {
    public static void main(String[] args) {
        orderingOutsideConeFirst();
        sketchCoreAndParentNeverEvicted();
        upperOnlyWhenRetouchOwned();
        System.out.println("LruEvictionPolicyTest OK");
    }

    private static EvictionCandidate brush(
            long id, int stratum, long dist, long painted, boolean inCone, boolean core) {
        return new EvictionCandidate(id, stratum, 48, dist, painted, inCone, core, false, false, 0, 4);
    }

    private static void orderingOutsideConeFirst() {
        EvictionPolicy policy = new LruEvictionPolicy();
        EvictionContext ctx = new EvictionContext(768, 768, 36864, 36864, false);
        List<EvictionCandidate> leaves = List.of(
                brush(1, 0, 10, 3, true, false),
                brush(2, 0, 999, 1, false, false),
                brush(3, 1, 9999, 0, false, false));
        List<EvictionAction> got = policy.select(leaves, ctx, 1, 0);
        check(got.size() == 1 && got.get(0).brushId() == 3, "finest outside cone first, got " + got);
    }

    private static void sketchCoreAndParentNeverEvicted() {
        EvictionPolicy policy = new LruEvictionPolicy();
        EvictionContext ctx = new EvictionContext(768, 768, 0, 36864, false);
        EvictionCandidate sketch =
                new EvictionCandidate(10, 7, 8, 0, 0, true, false, true, false, 0, 4);
        EvictionCandidate core = brush(11, 0, 0, 0, true, true);
        EvictionCandidate parent =
                new EvictionCandidate(12, 2, 48, 500, 0, false, false, false, true, 0, 4);
        EvictionCandidate ok = brush(13, 2, 500, 5, false, false);
        List<EvictionAction> got = policy.select(List.of(sketch, core, parent, ok), ctx, 10, 100000);
        check(got.size() == 1 && got.get(0).brushId() == 13, "protected entries leaked: " + got);
    }

    private static void upperOnlyWhenRetouchOwned() {
        EvictionPolicy policy = new LruEvictionPolicy();
        EvictionContext ctx = new EvictionContext(768, 768, 0, 36864, false);
        EvictionCandidate full =
                new EvictionCandidate(20, 0, 48, 100, 0, false, false, false, false, 0, 4);
        EvictionCandidate sketchBand =
                new EvictionCandidate(21, 0, 48, 0, 1, false, false, false, false, 0, 2);
        List<EvictionAction> got = policy.select(List.of(full, sketchBand), ctx, 2, 0);
        check(got.get(0).dropUpperOnly(), "expected upper-only for [0,4), got " + got);
        check(!got.get(1).dropUpperOnly(), "expected whole drop for [0,2), got " + got);
    }

    private static void check(boolean cond, String msg) {
        if (!cond) {
            throw new AssertionError(msg);
        }
    }
}
