package seurat.session;

import java.nio.ByteBuffer;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.concession.Concessions;
import seurat.concession.GrantController;
import seurat.config.SeuratConstants;
import seurat.net.Mapping;
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
            canvas.book().acknowledge(receipt.completed(), System.nanoTime(),
                    SeuratConstants.LEASE_S * 1_000_000_000L,
                    SeuratConstants.SKEW_MS * 1_000_000L);
            session.free = Math.max(1, receipt.free());
            session.queueMs = receipt.queueMs();
        }
    }

    void release(Session session, Frame f) {
        MsgLoans.Release release = MsgLoans.Release.parse(f.payload());
        Canvas canvas = canvas(session, release.handle());
        if (canvas != null) {
            synchronized (canvas) {
                canvas.book().release(release.ranges());
            }
        }
    }

    void scraped(Session session, Frame f) {
        MsgLoans.Scraped scraped = MsgLoans.Scraped.parse(f.payload());
        Canvas canvas = canvas(session, scraped.handle());
        if (canvas != null) {
            control.confirm(canvas, scraped);
        }
    }

    void inventory(Session session, Frame f) {
        MsgAudit.Inventory inventory = MsgAudit.Inventory.parse(f.payload());
        Canvas canvas = canvas(session, inventory.handle());
        if (canvas != null) {
            control.audit(canvas, inventory);
        }
    }

    void open(Session session, Frame f) {
        MsgCatalog.OpenWork request = MsgCatalog.OpenWork.parse(f.payload());
        WorkRecord work = catalog.get(request.id());
        if (work == null) {
            Easel.send(mapping, FrameType.ERROR, new MsgHandshake.ProtocolError(
                    ProtoCodes.ERR_OBRA_INEXISTENTE, 0, FrameType.ABRIR, "work").encode());
            return;
        }
        if (work.meta.state() == ProtoCodes.ST_RECIBIENDO
                || work.meta.state() == ProtoCodes.ST_FALLIDA) {
            Easel.send(mapping, FrameType.ERROR, new MsgHandshake.ProtocolError(
                    ProtoCodes.ERR_OBRA_NO_LISTA, 0, FrameType.ABRIR, "not ready")
                    .encode());
            return;
        }
        long handle = session.newHandle();
        long[] ceiling = work.ceiling(session.role());
        Canvas canvas = new Canvas(handle, request.id(), work.store, work.meta,
                Concessions.initial(session.memMib(), sessionMax, work.meta.strata() - 1));
        canvas.session(session);
        canvas.renewNs = System.nanoTime();
        canvas.auditNs = System.nanoTime();
        session.canvases().put(handle, canvas);
        int top = work.meta.strata() - 1;
        long paddedW = ((long) work.meta.width() + (1L << top) - 1) >> top << top;
        long paddedH = ((long) work.meta.height() + (1L << top) - 1) >> top << top;
        Easel.send(mapping, FrameType.ABIERTA, new MsgCatalog.WorkOpened(handle,
                work.meta.width(), work.meta.height(), work.meta.strata(),
                work.meta.edition(), (int) ceiling[0], (int) ceiling[1],
                paddedW >> top, paddedH >> top).encode());
        control.open(session, canvas);
    }

    void closeCanvas(Session session, Frame f) {
        ByteBuffer b = ByteBuffer.wrap(f.payload());
        session.canvases().remove(VarInt.get(b));
    }

    void sendCatalog(Session session) {
        for (WorkRecord work : catalog.all()) {
            Easel.send(mapping, FrameType.OBRA, new MsgCatalog.WorkMessage(
                    ProtoCodes.OBRA_LISTADO, work.meta.state(), 100,
                    work.meta.edition(), work.meta.width(), work.meta.height(),
                    work.meta.strata(), work.meta.id(), work.meta.name()).encode());
        }
    }
}
