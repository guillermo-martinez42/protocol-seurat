package seurat.session;

import java.nio.ByteBuffer;
import java.util.concurrent.BlockingQueue;
import seurat.catalog.Catalog;
import seurat.concession.GrantController;
import seurat.config.SeuratConstants;
import seurat.net.Mapping;
import seurat.observe.Log;
import seurat.paint.Painter;
import seurat.proto.FatalProtocol;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgHandshake;
import seurat.proto.ProtoCodes;

/** One virtual thread per session. Single writer of its session state. */
public final class Easel implements Runnable {
    private final Mapping mapping;
    private final BlockingQueue<byte[]> entry;
    private final Sessions sessions;
    private final Catalog catalog;
    private final GrantController control;
    private final int sessionMax;
    private CanvasService service;

    public Easel(Mapping mapping, BlockingQueue<byte[]> entry, Sessions sessions,
            Catalog catalog, GrantController control, Painter painter, int sessionMax) {
        this.mapping = mapping;
        this.entry = entry;
        this.sessions = sessions;
        this.catalog = catalog;
        this.control = control;
        this.sessionMax = sessionMax;
    }

    static void send(Mapping mapping, long type, byte[] payload) {
        try {
            mapping.sendControl(new Frame(type, payload).encode());
        } catch (Exception ex) {
            throw new RuntimeException(ex);
        }
    }

    @Override
    public void run() {
        Session session = null;
        try {
            session = new SessionHandshake(mapping, entry, sessions, sessionMax).hello();
            service = new CanvasService(mapping, catalog, control, sessionMax);
            loop(session);
        } catch (java.io.EOFException ex) {
            Log.info("session", "Session " + (session == null ? "?" : session.id())
                    + " client disconnected (EOF)");
        } catch (FatalProtocol fail) {
            Log.warn("session", "Fatal protocol error [session " + (session == null ? "?" : session.id())
                    + "]: " + ProtoCodes.errorName(fail.code) + " (ref=" + FrameType.name(fail.refType)
                    + "): " + fail.getMessage());
            if (session != null) {
                fail(session, fail.code, fail.refType);
            }
        } catch (Exception ex) {
            String detail = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
            Log.error("session", "Session error [session " + (session == null ? "?" : session.id())
                    + "]: " + detail, ex);
            if (session != null) {
                fail(session, ProtoCodes.ERR_INTERNO, 0);
            }
        } finally {
            close(session);
        }
    }

    private void close(Session session) {
        try {
            mapping.close();
        } catch (Exception ignored) {
        }
        if (session != null) {
            Log.info("session", "Session " + session.id() + " closed/retired");
            sessions.retire(session, (SeuratConstants.LEASE_S * 1000 + SeuratConstants.SKEW_MS) * 1_000_000L);
        }
    }

    private void fail(Session session, int code, long refType) {
        try {
            send(mapping, FrameType.ERROR, new MsgHandshake.ProtocolError(
                    code, 1, refType, "fail").encode());
        } catch (RuntimeException ignored) {
        }
    }

    private byte[] take() throws Exception {
        byte[] f = entry.take();
        if (f.length == 0) {
            throw new java.io.EOFException("control closed");
        }
        return f;
    }

    private void loop(Session session) throws Exception {
        for (;;) {
            Frame f = Frame.decode(ByteBuffer.wrap(take()));
            session.lastActivityNs = System.nanoTime();
            long type = f.type();
            Log.debug("proto", "Session " + session.id() + " received " + FrameType.name(type));
            if (type == FrameType.MIRADA) {
                service.gaze(session, f);
            } else if (type == FrameType.RECIBO) {
                service.receipt(session, f);
            } else if (type == FrameType.SOLTAR) {
                service.release(session, f);
            } else if (type == FrameType.RASPADO) {
                service.scraped(session, f);
            } else if (type == FrameType.INVENTARIO) {
                service.inventory(session, f);
            } else if (type == FrameType.ABRIR) {
                service.open(session, f);
            } else if (type == FrameType.CERRAR) {
                service.closeCanvas(session, f);
            } else if (type == FrameType.CATALOGO) {
                service.sendCatalog(session);
            } else if (type == FrameType.ADIOS) {
                Log.info("session", "Session " + session.id() + " sent ADIOS, closing cleanly");
                return;
            } else if (type != FrameType.ECO && Frame.mandatory(type)) {
                throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, type,
                        "unknown mandatory type");
            }
        }
    }
}
