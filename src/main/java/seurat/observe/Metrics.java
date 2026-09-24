package seurat.observe;

import java.util.concurrent.atomic.LongAdder;

/** Counters + Jain fairness index over served sharpness. */
public final class Metrics {
    public final LongAdder deliveries = new LongAdder();
    public final LongAdder bytes = new LongAdder();
    public final LongAdder scrapes = new LongAdder();
    public final LongAdder fatalErrors = new LongAdder();

    /** Jain J = (Σx)²/(n·Σx²) over per-session mean stratum served. */
    public static double jain(double[] xs) {
        if (xs.length == 0) {
            return 1.0;
        }
        double stratum = 0;
        double q = 0;
        for (double x : xs) {
            stratum += x;
            q += x * x;
        }
        if (q == 0) {
            return 1.0;
        }
        return (stratum * stratum) / (xs.length * q);
    }
}
