package seurat.concession;

import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgGaze;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.session.Canvas;
import seurat.session.Concession;

/** Policy widen/narrow application across open canvases. */
public final class PolicySync {
    private final GrantController grants;

    public PolicySync(GrantController grants) {
        this.grants = grants;
    }

    public void apply(Canvas canvas, long[] ceiling) {
        synchronized (canvas) {
            Concession current = canvas.concession();
            int floor = current.minStratum() >= 7 ? 7 : 0;
            int targetMin = (int) Math.max(ceiling[0], floor);
            int targetBands = targetMin == ceiling[0] ? (int) ceiling[1] : 4;
            if (targetMin == current.minStratum() && targetBands == current.maxBands()) {
                return;
            }
            Concession next = new Concession(current.epoch() + 1, targetMin,
                    targetBands, ProtoCodes.MOT_POLITICA, current.maxBrushes(),
                    current.maxKiB(), current.leaseS());
            if (targetMin > current.minStratum()) {
                grants.narrow(canvas, next,
                        Concessions.lowStratum(targetMin),
                        MsgLoans.Scrape.lowStratum(canvas.handle(), 0, next.epoch(), 0,
                                targetMin));
                return;
            }
            canvas.setConcession(next);
            var message = new MsgGaze.ConcessionMessage(canvas.handle(), next.epoch(),
                    next.minStratum(), next.maxBands(), next.reason(), next.maxBrushes(),
                    next.maxKiB(), next.leaseS());
            try {
                canvas.session().mapping().sendControl(
                        new Frame(FrameType.CONCESION, message.encode()).encode());
            } catch (Exception ex) {
                throw new RuntimeException(ex);
            }
        }
    }
}
