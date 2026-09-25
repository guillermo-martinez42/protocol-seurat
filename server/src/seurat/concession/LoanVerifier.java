package seurat.concession;

import seurat.observe.Log;
import seurat.proto.FatalProtocol;
import seurat.proto.FrameType;
import seurat.proto.MsgAudit;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.session.Canvas;

/** Exact-set confirmation of SCRAPED / INVENTORY, or fatal ERROR 7. */
final class LoanVerifier {
    private LoanVerifier() {}

    static void confirm(Canvas canvas, MsgLoans.Scraped scraped) {
        synchronized (canvas) {
            Canvas.ScrapeOrder order = canvas.pendingOrder(scraped.order());
            if (order == null) {
                return;
            }
            var expected = canvas.book().expected(order.through(), order.scrape(),
                    order.cancelled());
            if (!expected.equals(scraped.kept())) {
                Log.warn("audit", "Scrape possession mismatch on canvas " + canvas.handle()
                        + ": expected " + expected + ", got " + scraped.kept());
                throw new FatalProtocol(ProtoCodes.ERR_POSESION,
                        FrameType.RASPADO, "POSESION_DISCREPANTE");
            }
            canvas.book().retainOnly(order.through(), scraped.kept());
            canvas.resolve(order);
        }
    }

    static void audit(Canvas canvas, MsgAudit.Inventory inventory) {
        synchronized (canvas) {
            var expected = canvas.book().numbersThrough(inventory.through());
            if (!expected.equals(inventory.ranges())) {
                Log.warn("audit", "Inventory audit mismatch on canvas " + canvas.handle()
                        + ": order=" + inventory.order() + " through=" + inventory.through()
                        + " lastNumber=" + canvas.book().lastNumber()
                        + " pendingOrders=" + canvas.pendingOrders().size()
                        + " expected " + expected + ", got " + inventory.ranges());
                throw new FatalProtocol(ProtoCodes.ERR_POSESION,
                        FrameType.INVENTARIO, "POSESION_DISCREPANTE");
            }
        }
    }
}
