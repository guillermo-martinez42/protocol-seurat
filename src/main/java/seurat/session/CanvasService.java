package seurat.session;

import java.nio.ByteBuffer;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.concession.GrantController;
import seurat.config.SeuratConstants;
import seurat.net.Mapping;
import seurat.observe.Log;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgAudit;
import seurat.proto.MsgCatalog;
import seurat.proto.MsgGaze;
import seurat.proto.MsgHandshake;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.VarInt;

/** Per-frame handlers: open/close/catalog/gaze/loans. Null canvas = skip. */
final class CanvasService {
    private final Mapping mapping;
    private final Catalog catalog;
    private final GrantController control;
    private final int sessionMax;

    CanvasService(Mapping mapping, Catalog catalog, GrantController control,
            int sessionMax) {
        this.mapping = mapping;
        this.catalog = catalog;
        this.control = control;
        this.sessionMax = sessionMax;
    }

    Canvas canvas(Session session, long handle) {
        Canvas canvas = session.canvases().get(handle);
        if (canvas == null) {
            Log.warn("session", "Session " + session.id() + " invalid canvas handle: " + handle);
            Easel.send(mapping, FrameType.ERROR, new MsgHandshake.ProtocolError(
                    ProtoCodes.ERR_HANDLE, 0, handle, "HANDLE").encode());
        }
        return canvas;
    }

    void gaze(Session session, Frame f) {
        MsgGaze.Gaze gaze = MsgGaze.Gaze.parse(f.payload());
        session.lastGazeNs = System.nanoTime();
        Canvas canvas = canvas(session, gaze.handle());
        if (canvas != null) {
            Log.debug("gaze", "Session " + session.id() + " h=" + gaze.handle() + " gaze: ["
                    + gaze.x0() + "," + gaze.y0() + ".." + gaze.x1() + "," + gaze.y1()
                    + "] seq=" + gaze.seq());
            control.gaze(session, canvas, gaze);
        }
    }

    void receipt(Session session, Frame f) {
        MsgLoans.Receipt receipt = MsgLoans.Receipt.parse(f.payload());
        Canvas canvas = canvas(session, receipt.handle());
        if (canvas == null) {
            return;
        }
        synchronized (canvas) {
            long now = System.nanoTime();
            long leaseNs = SeuratConstants.LEASE_S * 1_000_000_000L;
            long skewNs = SeuratConstants.SKEW_MS * 1_000_000L;
            canvas.book().acknowledge(receipt.completed(), now, leaseNs, skewNs);
            canvas.book().settle(receipt.completed());
            if (receipt.renewThrough() > 0) {
                canvas.acknowledgeRenewal(receipt.renewThrough(), now, leaseNs, skewNs);
            }
            session.free = Math.max(1, receipt.free());
            session.queueMs = receipt.queueMs();
            Log.debug("loan", "Session " + session.id() + " h=" + receipt.handle()
                    + " receipt: ack=" + receipt.completed() + " free=" + session.free);
        }
    }

    void release(Session session, Frame f) {
        MsgLoans.Release release = MsgLoans.Release.parse(f.payload());
        Canvas canvas = canvas(session, release.handle());
        if (canvas != null) {
            synchronized (canvas) {
                canvas.book().release(release.ranges());
                Log.debug("loan", "Session " + session.id() + " h=" + release.handle()
                        + " released brushes: " + release.ranges());
            }
        }
    }

    void scraped(Session session, Frame f) {
        MsgLoans.Scraped scraped = MsgLoans.Scraped.parse(f.payload());
        Canvas canvas = canvas(session, scraped.handle());
        if (canvas != null) {
            Log.debug("loan", "Session " + session.id() + " h=" + scraped.handle()
                    + " scraped confirmed order=" + scraped.order());
            control.confirm(canvas, scraped);
        }
    }

    void inventory(Session session, Frame f) {
        MsgAudit.Inventory inventory = MsgAudit.Inventory.parse(f.payload());
        Canvas canvas = canvas(session, inventory.handle());
        if (canvas != null) {
            Log.debug("audit", "Session " + session.id() + " h=" + inventory.handle()
                    + " inventory audit: through=" + inventory.through());
            control.audit(canvas, inventory);
        }
    }

    void open(Session session, Frame f) {
        CanvasOpener.open(mapping, catalog, control, sessionMax, session, f);
    }

    void closeCanvas(Session session, Frame f) {
        ByteBuffer b = ByteBuffer.wrap(f.payload());
        long handle = VarInt.get(b);
        session.canvases().remove(handle);
        Log.info("session", "Session " + session.id() + " closed canvas handle=" + handle);
    }

    void sendCatalog(Session session) {
        Log.info("catalog", "Sending catalog listing to session " + session.id());
        for (WorkRecord work : catalog.all()) {
            Easel.send(mapping, FrameType.OBRA, new MsgCatalog.WorkMessage(
                    ProtoCodes.OBRA_LISTADO, work.meta.state(), 100,
                    work.meta.edition(), work.meta.width(), work.meta.height(),
                    work.meta.strata(), work.meta.id(), work.meta.name()).encode());
        }
    }
}
