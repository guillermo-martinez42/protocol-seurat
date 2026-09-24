package seurat.session;

import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.concession.Concessions;
import seurat.concession.GrantController;
import seurat.net.Mapping;
import seurat.observe.Log;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgCatalog;
import seurat.proto.MsgHandshake;
import seurat.proto.ProtoCodes;

/** Factory for opening a work on a session canvas. */
final class CanvasOpener {
    private CanvasOpener() {}

    static void open(Mapping mapping, Catalog catalog, GrantController control,
            int sessionMax, Session session, Frame f) {
        MsgCatalog.OpenWork request = MsgCatalog.OpenWork.parse(f.payload());
        WorkRecord work = catalog.get(request.id());
        if (work == null) {
            Log.warn("session", "Session " + session.id() + " open failed: work not found '" + request.id() + "'");
            Easel.send(mapping, FrameType.ERROR, new MsgHandshake.ProtocolError(
                    ProtoCodes.ERR_OBRA_INEXISTENTE, 0, FrameType.ABRIR, "work").encode());
            return;
        }
        if (work.meta.state() == ProtoCodes.ST_RECIBIENDO
                || work.meta.state() == ProtoCodes.ST_FALLIDA) {
            Log.warn("session", "Session " + session.id() + " open failed: work '" + request.id()
                    + "' not ready (state=" + ProtoCodes.stateName(work.meta.state()) + ")");
            Easel.send(mapping, FrameType.ERROR, new MsgHandshake.ProtocolError(
                    ProtoCodes.ERR_OBRA_NO_LISTA, 0, FrameType.ABRIR, "not ready").encode());
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
        Log.info("session", "Session " + session.id() + " opened canvas " + handle + " for work '"
                + request.id() + "' (" + work.meta.width() + "x" + work.meta.height() + ", strata="
                + work.meta.strata() + ", ed=" + work.meta.edition() + ")");
        Easel.send(mapping, FrameType.ABIERTA, new MsgCatalog.WorkOpened(handle,
                work.meta.width(), work.meta.height(), work.meta.strata(),
                work.meta.edition(), (int) ceiling[0], (int) ceiling[1],
                paddedW >> top, paddedH >> top).encode());
        control.open(session, canvas);
    }
}
