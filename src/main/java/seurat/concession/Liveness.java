package seurat.concession;

import seurat.config.SeuratConstants;
import seurat.proto.FatalProtocol;
import seurat.proto.FrameType;
import seurat.proto.MsgAudit;
import seurat.proto.MsgHandshake;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Session;
import seurat.session.Sessions;

/** 1s liveness: RENEW/AUDIT, 10s scrape timeouts, 60s inactivity floor. */
public final class Liveness {
    private final GrantController grants;
    private final Sessions sessions;

    public Liveness(GrantController grants, Sessions sessions) {
        this.grants = grants;
        this.sessions = sessions;
    }

    public void tick() {
        long now = System.nanoTime();
        for (Session session : sessions.all()) {
            if (session.lastActivityNs > 0
                    && now - session.lastActivityNs > 3 * SeuratConstants.HEARTBEAT_S * 1_000_000_000L) {
                close(session, ProtoCodes.ERR_PROTOCOLO, FrameType.LATIDO);
                continue;
            }
            for (Canvas canvas : session.canvases().values()) {
                try {
                    tickCanvas(session, canvas, now);
                } catch (FatalProtocol fail) {
                    close(session, fail.code, fail.refType);
                    break;
                } catch (RuntimeException ex) {
                    close(session, ProtoCodes.ERR_INTERNO, 0);
                    break;
                }
            }
        }
    }

    private void tickCanvas(Session session, Canvas canvas, long now) {
        synchronized (canvas) {
            for (Canvas.ScrapeOrder order : canvas.pendingOrders()) {
                if (order.deadlineNs() < now) {
                    throw new FatalProtocol(ProtoCodes.ERR_LIQUIDACION,
                            FrameType.RASPADO, "LIQUIDACION_VENCIDA");
                }
            }
            canvas.book().pruneExpired(now);
            if (session.lastGazeNs > 0
                    && now - session.lastGazeNs > SeuratConstants.IDLE_S * 1_000_000_000L
                    && canvas.concession().minStratum() < SeuratConstants.SKETCH_MIN) {
                Concession current = canvas.concession();
                grants.narrow(canvas, new Concession(current.epoch() + 1,
                        SeuratConstants.SKETCH_MIN, 4, ProtoCodes.MOT_INACTIVIDAD,
                        current.maxBrushes(), current.maxKiB(), current.leaseS()),
                        Concessions.lowStratum(SeuratConstants.SKETCH_MIN),
                        MsgLoans.Scrape.lowStratum(canvas.handle(), 0,
                                current.epoch() + 1, 0, SeuratConstants.SKETCH_MIN));
            }
            if (now - canvas.renewNs > SeuratConstants.RENEW_S * 1_000_000_000L) {
                canvas.renewNs = now;
                long order = canvas.nextOrder();
                Ranges ranges = canvas.book().numbersThrough(canvas.book().lastNumber());
                canvas.addPendingRenewal(order, ranges);
                GrantController.send(session, FrameType.RENOVAR,
                        new MsgAudit.Renew(canvas.handle(), order,
                                SeuratConstants.LEASE_S, ranges).encode());
            }
            long done = canvas.book().lastNumber();
            if (now - canvas.auditNs > SeuratConstants.AUDIT_S * 1_000_000_000L
                    || done - canvas.auditBase > SeuratConstants.AUDIT_EVERY_N) {
                canvas.auditNs = now;
                canvas.auditBase = done;
                GrantController.send(session, FrameType.AUDITAR,
                        new MsgAudit.Audit(canvas.handle(), canvas.nextOrder(), done)
                                .encode());
            }
        }
    }

    private void close(Session session, int code, long refType) {
        try {
            GrantController.send(session, FrameType.ERROR,
                    new MsgHandshake.ProtocolError(code, 1, refType, "fatal").encode());
        } catch (RuntimeException ignored) {
        }
        try {
            session.mapping().close();
        } catch (Exception ignored) {
        }
        sessions.retire(session,
                (SeuratConstants.LEASE_S * 1000 + SeuratConstants.SKEW_MS) * 1_000_000L);
    }
}
