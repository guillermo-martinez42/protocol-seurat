package seurat.paint;

import java.util.Comparator;
import seurat.plan.PlanEntry;
import seurat.session.Canvas;

/** Queued plan entry. Order: effective class, pass, stride step. */
public record Pending(Canvas canvas, PlanEntry entry, long queuedNs, long stride,
        long edition) {
    public Pending(Canvas canvas, PlanEntry entry, long queuedNs, long stride) {
        this(canvas, entry, queuedNs, stride, canvas.meta().edition());
    }
    public int effectiveClass() {
        long waitMs = (System.nanoTime() - queuedNs) / 1_000_000;
        return (int) Math.min(10, entry.brush().stratum() + waitMs / 500);
    }

    public static final Comparator<Pending> ORDER = Comparator
            .comparingInt(Pending::effectiveClass).reversed()
            .thenComparingInt(p -> p.entry().pass())
            .thenComparingLong(Pending::stride);
}
