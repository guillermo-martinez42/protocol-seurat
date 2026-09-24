package seurat.paint;

import java.util.List;
import java.util.concurrent.PriorityBlockingQueue;
import seurat.codec.BrushId;
import java.util.concurrent.Semaphore;
import seurat.budget.BrushBudget;
import seurat.config.SeuratConstants;
import seurat.observe.Metrics;
import seurat.plan.PlanEntry;
import seurat.regulate.Regulator;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Delivery;

/**
 * Sole point through which points leave the server. Chooser thread does no
 * IO; up to 512 virtual workers copy bytes. Number + annotate BEFORE bytes.
 */
public final class Painter implements Runnable {
    private final PriorityBlockingQueue<Pending> queue =
            new PriorityBlockingQueue<>(4096, Pending.ORDER);
    private final Semaphore globalSlots =
            new Semaphore(SeuratConstants.GLOBAL_SLOTS);
    private final Regulator regulator;
    private final DeliveryWriter writer;
    private final BudgetApplier applier;
    private final InFlightDeliveries inFlight = new InFlightDeliveries();

    public Painter(Regulator regulator, BrushBudget budget, Metrics metrics) {
        this.regulator = regulator;
        this.writer = new DeliveryWriter(metrics, globalSlots, inFlight);
        this.applier = new BudgetApplier(budget);
    }

    /** Replaces the pending plan of a canvas (unopened entries discarded). */
    public void enqueue(Canvas canvas, List<PlanEntry> entries) {
        queue.removeIf(p -> p.canvas() == canvas);
        long now = System.nanoTime();
        for (PlanEntry entry : entries) {
            queue.add(new Pending(canvas, entry, now, canvas.session().stride));
        }
    }

    /** Budget finalize before PLAN START (see BudgetApplier). */
    public BudgetedPlan applyBudget(Canvas canvas, List<PlanEntry> entries) {
        return applier.apply(canvas, entries);
    }

    /**
     * Revocation purge: drops queued entries the concession forbids and
     * cancels violating in-flight deliveries. Returns the cancelled ranges.
     */
    public seurat.proto.Ranges purge(Canvas canvas, Concession next) {
        queue.removeIf(p -> p.canvas() == canvas
                && (!next.allows(p.entry().brush(), p.entry().through())
                        || p.edition() != canvas.meta().edition()));
        return inFlight.purge(canvas, next);
    }

    @Override
    public void run() {
        for (;;) {
            try {
                Pending x = queue.take();
                serve(x);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void serve(Pending pending) {
        Canvas canvas = pending.canvas();
        synchronized (canvas) {
            Concession concession = canvas.concession();
            var book = canvas.book();
            BrushId brush = pending.entry().brush();
            int through = pending.entry().through();
            if (pending.edition() != canvas.meta().edition()
                    || !concession.allows(brush, through)
                    || (brush.stratum() < 10 && book.bands(brush.parentCapped(
                            canvas.meta().strata() - 1)) < through)) {
                return;
            }
            if (book.size() >= concession.maxBrushes()
                    || canvas.session().inFlight() >= canvas.session().free) {
                queue.add(pending);
                return;
            }
            if (!canvas.session().takeSlot()) {
                queue.add(pending);
                return;
            }
            if (!globalSlots.tryAcquire()) {
                canvas.session().releaseSlot();
                queue.add(pending);
                return;
            }
            regulator.onStart(canvas.session(), System.nanoTime() - pending.queuedNs());
            Delivery delivery;
            try {
                delivery = book.log(brush, pending.entry().from(), through,
                        (int) Math.min(Integer.MAX_VALUE, canvas.store().bytes(brush,
                                pending.entry().from(), through)),
                        concession.epoch());
            } catch (Exception ex) {
                canvas.session().releaseSlot();
                globalSlots.release();
                return;
            }
            canvas.session().stride += Math.max(1, delivery.bytes());
            Delivery done = delivery;
            inFlight.add(canvas, done);
            Thread.ofVirtual().start(() -> writer.write(canvas, done));
        }
    }
}
