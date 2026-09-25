package seurat.regulate;

import java.util.Collection;
import seurat.config.SeuratConstants;
import seurat.session.Session;

/** CoDel over the Painter queue + per-session DCTCP response. */
public final class Regulator {
    private long minDwell = Long.MAX_VALUE;
    private volatile boolean congested;

    public synchronized void onStart(Session session, long dwellNs) {
        minDwell = Math.min(minDwell, dwellNs);
        session.tickDeliveries++;
        if (congested) {
            session.tickMarked++;
        }
    }

    /** Every 250ms: persistent queue (min dwell > 25ms) means congestion. */
    public synchronized void tick(Collection<Session> sessions) {
        congested = minDwell != Long.MAX_VALUE
                && minDwell > SeuratConstants.CODEL_TARGET_NS;
        minDwell = Long.MAX_VALUE;
        for (Session session : sessions) {
            double f = session.tickDeliveries == 0 ? 0 : (double) session.tickMarked / session.tickDeliveries;
            session.alpha = (1 - 1.0 / 16) * session.alpha + f / 16;
            session.share = f > 0 ? Math.max(0.125, session.share * (1 - session.alpha / 2))
                    : Math.min(1.0, session.share + 1.0 / 32);
            session.tickDeliveries = 0;
            session.tickMarked = 0;
        }
    }

    public boolean congested() {
        return congested;
    }
}
