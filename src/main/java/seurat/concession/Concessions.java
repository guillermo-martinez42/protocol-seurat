package seurat.concession;

import java.util.function.Predicate;
import seurat.config.SeuratConstants;
import seurat.proto.ProtoCodes;
import seurat.session.Concession;
import seurat.session.Delivery;

/** Concession factory + scrape predicates. Pure, no IO. */
public final class Concessions {
    private Concessions() {}

    public static Concession initial(long memMib, int sessionMax, int top) {
        int maxBrushes = (int) Math.min(memMib * 3, sessionMax);
        int sketchMin = Math.min(SeuratConstants.SKETCH_MIN, Math.max(0, top - 1));
        return new Concession(1, sketchMin, 4,
                ProtoCodes.MOT_INICIAL, maxBrushes, maxBrushes * 48,
                SeuratConstants.LEASE_S);
    }

    public static Predicate<Delivery> lowStratum(int stratum) {
        return delivery -> delivery.brush().stratum() < stratum
                && delivery.brush().stratum() < SeuratConstants.SKETCH_MIN;
    }

    public static Predicate<Delivery> all() {
        return delivery -> true;
    }
}
