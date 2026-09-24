package seurat.concession;

import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import java.util.function.Predicate;
import seurat.config.SeuratConstants;
import seurat.paint.Painter;
import seurat.plan.ConePlanner;
import seurat.plan.ConeTiling;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgGaze;
import seurat.proto.MsgAudit;
import seurat.proto.MsgHandshake;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.session.Concession;
import seurat.session.Canvas;
import seurat.session.Delivery;
import seurat.session.Session;
import seurat.session.Sessions;

/** Rights path: CONCESION / RASPAR / RENOVAR / AUDITAR. Exact-set confirm. */
public final class GrantController {
    private final Catalog catalog;
    private final Painter painter;

    public GrantController(Catalog catalog, Painter painter, Sessions sessions) {
        this.catalog = catalog;
        this.painter = painter;
    }

        static void send(Session session, long type, byte[] payload) {
        try {
            session.mapping().sendControl(new Frame(type, payload).encode());
        } catch (Exception ex) {
            throw new RuntimeException(ex);
        }
    }

    /** ABRIR follow-up: initial concession + sketch plan. */
    public void open(Session session, Canvas canvas) {
        synchronized (canvas) {
            send(session, FrameType.CONCESION, concessionMessage(canvas).encode());
            var plan = ConeTiling.sketch(canvas.meta(), canvas.concession().minStratum(),
                    canvas.book()::bands);
            var budgeted = painter.applyBudget(canvas, plan);
            long first = canvas.book().lastNumber() + 1;
            send(session, FrameType.PLAN, MsgGaze.Plan
                    .start(canvas.handle(), 0, first, budgeted.entries().size(), budgeted.throttle())
                    .encode());
            canvas.startPlan(first, budgeted.entries().size());
            painter.enqueue(canvas, budgeted.entries());
        }
    }

    private MsgGaze.ConcessionMessage concessionMessage(Canvas canvas) {
        Concession c = canvas.concession();
        return new MsgGaze.ConcessionMessage(canvas.handle(), c.epoch(), c.minStratum(),
                c.maxBands(), c.reason(), c.maxBrushes(), c.maxKiB(), c.leaseS());
    }

    /** MIRADA: widen when the inactivity floor lifts, then (re)plan. */
    public void gaze(Session session, Canvas canvas, MsgGaze.Gaze gaze) {
        synchronized (canvas) {
            canvas.setGaze(gaze);
            WorkRecord work = catalog.get(canvas.workId());
            long[] ceiling = work == null ? new long[]{0, 2} : work.ceiling(session.role());
            boolean hidden = (gaze.flags() & MsgGaze.M_OCULTA) != 0;
            Concession current = canvas.concession();
            if (hidden) {
                if (current.minStratum() < SeuratConstants.SKETCH_MIN) {
                    narrow(canvas, new Concession(current.epoch() + 1, SeuratConstants.SKETCH_MIN, 4,
                            ProtoCodes.MOT_OCULTA, current.maxBrushes(), current.maxKiB(), current.leaseS()),
                            Concessions.lowStratum(SeuratConstants.SKETCH_MIN),
                            MsgLoans.Scrape.lowStratum(canvas.handle(), 0, current.epoch() + 1, 0,
                                    SeuratConstants.SKETCH_MIN));
                }
                return;
            }
            int floor = 0;
            int targetMin = (int) Math.max(ceiling[0], floor);
            int targetBands = targetMin == ceiling[0] ? (int) ceiling[1] : 4;
            if (targetMin < current.minStratum()) {
                Concession widened = new Concession(current.epoch() + 1, targetMin, targetBands,
                        ProtoCodes.MOT_MIRADA, current.maxBrushes(), current.maxKiB(), current.leaseS());
                canvas.setConcession(widened);
                send(session, FrameType.CONCESION, concessionMessage(canvas).encode());
            }
            var planned = ConePlanner.plan(gaze, canvas.concession(), canvas.book()::bands,
                    canvas.meta(), session.share, session.queueMs);
            var budgeted = painter.applyBudget(canvas, planned.entries());
            int flags = planned.throttle() | budgeted.throttle();
            long first = canvas.book().lastNumber() + 1;
            send(session, FrameType.PLAN, MsgGaze.Plan
                    .start(canvas.handle(), gaze.seq(), first, budgeted.entries().size(), flags).encode());
            canvas.startPlan(first, budgeted.entries().size());
            painter.enqueue(canvas, budgeted.entries());
        }
    }

    /** Atomic barrier-free reduction: epoch+1, N, purge, CONCESION->CANCEL->RASPAR. */
    public void narrow(Canvas canvas, Concession next, Predicate<Delivery> scrape,
            MsgLoans.Scrape cableBase) {
        Session session = canvas.session();
        synchronized (canvas) {
            canvas.setConcession(next);
            long n = canvas.book().lastNumber();
            Ranges cancelled = painter.purge(canvas, next);
            send(session, FrameType.CONCESION, concessionMessage(canvas).encode());
            if (!cancelled.isEmpty()) {
                send(session, FrameType.PLAN, MsgGaze.Plan
                        .cancelled(canvas.handle(), canvas.gazeSeq(), cancelled).encode());
            }
            long order = canvas.nextOrder();
            send(session, FrameType.RASPAR, cableBase.at(order, n).encode());
            canvas.addPendingOrder(new Canvas.ScrapeOrder(order, n, next.epoch(), scrape,
                    cancelled, System.nanoTime() + SeuratConstants.SCRAPE_TIMEOUT_S * 1_000_000_000L));
        }
    }

    /** SCRAPED: exact set equality or fail ERROR 7. */
    public void confirm(Canvas canvas, MsgLoans.Scraped scraped) {
        LoanVerifier.confirm(canvas, scraped);
    }

    public void audit(Canvas canvas, MsgAudit.Inventory inventory) {
        LoanVerifier.audit(canvas, inventory);
    }

    /** Full revoke + retire: scrape, then ERROR 4 and drop the canvas. */
    public void withdraw(Canvas canvas) {
        Session session = canvas.session();
        synchronized (canvas) {
            Concession current = canvas.concession();
            narrow(canvas, new Concession(current.epoch() + 1, current.minStratum(),
                    current.maxBands(), ProtoCodes.MOT_POLITICA, current.maxBrushes(),
                    current.maxKiB(), current.leaseS()), Concessions.all(),
                    MsgLoans.Scrape.all(canvas.handle(), 0, current.epoch() + 1, 0));
            send(session, FrameType.ERROR, new MsgHandshake.ProtocolError(
                    ProtoCodes.ERR_OBRA_INEXISTENTE, 0, FrameType.ABRIR, "work").encode());
            session.canvases().remove(canvas.handle());
        }
    }
}
