package seurat.concession;

import java.util.function.Predicate;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.config.SeuratConstants;
import seurat.observe.Log;
import seurat.paint.Painter;
import seurat.plan.ConePlanner;
import seurat.plan.ConeTiling;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgAudit;
import seurat.proto.MsgGaze;
import seurat.proto.MsgHandshake.ProtocolError;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.Concession;
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
            send(session, FrameType.CONCESION, Concessions.message(canvas).encode());
            var plan = ConeTiling.sketch(canvas.meta(), canvas.concession().minStratum(), canvas.book()::bands);
            var budgeted = painter.applyBudget(canvas, plan);
            long first = canvas.book().lastNumber() + 1;
            int n = budgeted.entries().size();
            send(session, FrameType.PLAN, MsgGaze.Plan.start(canvas.handle(), 0, first, n, budgeted.throttle()).encode());
            canvas.startPlan(first, n);
            painter.enqueue(canvas, budgeted.entries());
            Log.info("concession", "Session " + session.id() + " canvas " + canvas.handle()
                    + " initial concession (stratum=" + canvas.concession().minStratum()
                    + ".." + canvas.meta().strata() + ", maxBands=" + canvas.concession().maxBands() + ")");
        }
    }

    /** MIRADA: widen when the inactivity floor lifts, then (re)plan. */
    public void gaze(Session session, Canvas canvas, MsgGaze.Gaze gaze) {
        synchronized (canvas) {
            canvas.setGaze(gaze);
            WorkRecord work = catalog.get(canvas.workId());
            long[] ceiling = work == null ? new long[]{0, 2} : work.ceiling(session.role());
            if ((gaze.flags() & MsgGaze.M_OCULTA) != 0) {
                hide(canvas);
                return;
            }
            int floor = 0;
            int targetMin = (int) Math.max(ceiling[0], floor);
            int targetBands = targetMin == ceiling[0] ? (int) ceiling[1] : 4;
            Concession current = canvas.concession();
            if (targetMin < current.minStratum()) {
                Concession widened = new Concession(current.epoch() + 1, targetMin, targetBands,
                        ProtoCodes.MOT_MIRADA, current.maxBrushes(), current.maxKiB(), current.leaseS());
                canvas.setConcession(widened);
                send(session, FrameType.CONCESION, Concessions.message(canvas).encode());
            }
            var planned = ConePlanner.plan(gaze, canvas.concession(), canvas.book()::bands,
                    canvas.meta(), session.share, session.queueMs);
            var budgeted = painter.applyBudget(canvas, planned.entries());
            int flags = planned.throttle() | budgeted.throttle();
            long first = canvas.book().lastNumber() + 1;
            int n = budgeted.entries().size();
            send(session, FrameType.PLAN, MsgGaze.Plan.start(canvas.handle(), gaze.seq(), first, n, flags).encode());
            canvas.startPlan(first, n);
            painter.enqueue(canvas, budgeted.entries());
            Log.debug("plan", "Session " + session.id() + " canvas " + canvas.handle()
                    + " plan: " + n + " brushes (seq=" + gaze.seq() + ")");
        }
    }

    private void hide(Canvas canvas) {
        Concession current = canvas.concession();
        int sMin = Concessions.sketchMin(canvas.meta().strata() - 1);
        if (current.minStratum() < sMin) {
            narrow(canvas, new Concession(current.epoch() + 1, sMin, 4,
                    ProtoCodes.MOT_OCULTA, current.maxBrushes(), current.maxKiB(), current.leaseS()),
                    Concessions.lowStratum(sMin),
                    MsgLoans.Scrape.lowStratum(canvas.handle(), 0, current.epoch() + 1, 0, sMin));
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
            send(session, FrameType.CONCESION, Concessions.message(canvas).encode());
            if (!cancelled.isEmpty()) {
                send(session, FrameType.PLAN, MsgGaze.Plan
                        .cancelled(canvas.handle(), canvas.gazeSeq(), cancelled).encode());
            }
            long order = canvas.nextOrder();
            send(session, FrameType.RASPAR, cableBase.at(order, n).encode());
            canvas.addPendingOrder(new Canvas.ScrapeOrder(order, n, next.epoch(), scrape,
                    cancelled, System.nanoTime() + SeuratConstants.SCRAPE_TIMEOUT_S * 1_000_000_000L));
            Log.info("concession", "Session " + session.id() + " canvas " + canvas.handle()
                    + " concession narrowed: " + ProtoCodes.motiveName(next.reason())
                    + " (epoch=" + next.epoch() + ", minStratum=" + next.minStratum() + ")");
        }
    }

    public void confirm(Canvas c, MsgLoans.Scraped s) { LoanVerifier.confirm(c, s); }
    public void audit(Canvas c, MsgAudit.Inventory i) { LoanVerifier.audit(c, i); }

    /** Full revoke + retire: scrape, then ERROR 4 and drop the canvas. */
    public void withdraw(Canvas canvas) {
        Session session = canvas.session();
        synchronized (canvas) {
            Concession current = canvas.concession();
            narrow(canvas, new Concession(current.epoch() + 1, current.minStratum(),
                    current.maxBands(), ProtoCodes.MOT_POLITICA, current.maxBrushes(),
                    current.maxKiB(), current.leaseS()), Concessions.all(),
                    MsgLoans.Scrape.all(canvas.handle(), 0, current.epoch() + 1, 0));
            send(session, FrameType.ERROR, new ProtocolError(
                    ProtoCodes.ERR_OBRA_INEXISTENTE, 0, FrameType.ABRIR, "work").encode());
            session.canvases().remove(canvas.handle());
            Log.info("concession", "Session " + session.id() + " canvas " + canvas.handle() + " withdrawn");
        }
    }
}
