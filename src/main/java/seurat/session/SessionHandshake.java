package seurat.session;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import seurat.config.SeuratConstants;
import seurat.proto.FatalProtocol;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgGaze;
import seurat.proto.MsgHandshake;
import seurat.proto.ProtoCodes;

/** SALUDO validation (single-use token) + optional RESUME adoption. */
final class SessionHandshake {
    private final seurat.net.Mapping ref;
    private final BlockingQueue<byte[]> entry;
    private final Sessions sessions;
    private final int sessionMax;

    SessionHandshake(seurat.net.Mapping mapping, BlockingQueue<byte[]> entry,
            Sessions sessions, int sessionMax) {
        this.ref = mapping;
        this.entry = entry;
        this.sessions = sessions;
        this.sessionMax = sessionMax;
    }

    Session hello() throws Exception {
        byte[] raw = entry.take();
        if (raw.length == 0) {
            throw new java.io.EOFException("control closed");
        }
        Frame f = Frame.decode(ByteBuffer.wrap(raw));
        if (f.type() != FrameType.SALUDO) {
            throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, f.type(), "missing SALUDO");
        }
        MsgHandshake.Hello hello = MsgHandshake.Hello.parse(f.payload());
        if (hello.maxVersion() < 1 || hello.minVersion() > 1) {
            throw new FatalProtocol(ProtoCodes.ERR_VERSION, f.type(), "VERSION");
        }
        Sessions.Token token = sessions.consumeToken(Hex.hex(hello.token()));
        if (token == null) {
            throw new FatalProtocol(ProtoCodes.ERR_AUTENTICACION, f.type(), "token");
        }
        long caps = hello.caps() & ProtoCodes.CAP_REANUDAR;
        Session session = new Session(sessions.reserveId(), token.principal(),
                token.role(), token.memMib(), caps, ref, sessions.newTicket());
        sessions.add(session);
        List<Long> resumed = List.of();
        if (hello.resume() != null) {
            resumed = resume(session, hello.resume());
        }
        var welcome = new MsgHandshake.Welcome(1, caps, session.id(),
                SeuratConstants.BRUSH_SIDE, SeuratConstants.LEASE_S,
                SeuratConstants.HEARTBEAT_S, SeuratConstants.MAX_IN_FLIGHT, sessionMax,
                session.ticket(), resumed);
        Easel.send(ref, FrameType.BIENVENIDA, welcome.encode());
        for (long h : resumed) {
            Canvas c = session.canvases().get(h);
            if (c != null) {
                Concession con = c.concession();
                var msg = new MsgGaze.ConcessionMessage(h, con.epoch(), con.minStratum(),
                        con.maxBands(), con.reason(), con.maxBrushes(), con.maxKiB(), con.leaseS());
                Easel.send(ref, FrameType.CONCESION, msg.encode());
            }
        }
        return session;
    }

    private List<Long> resume(Session session, MsgHandshake.ResumeRequest request) {
        Sessions.Grave grave = sessions.recover(request.previousSession());
        boolean ok = grave != null
                && Arrays.equals(grave.session().ticket(), request.ticket())
                && grave.session().principal().equals(session.principal());
        if (ok) {
            for (var claim : request.claims()) {
                Canvas canvas = grave.session().canvases().get(claim.handle());
                ok = canvas != null && covers(canvas, claim.ranges());
                if (!ok) {
                    break;
                }
            }
        }
        if (!ok) {
            Easel.send(ref, FrameType.ERROR, new MsgHandshake.ProtocolError(
                    ProtoCodes.ERR_REANUDACION, 0, FrameType.SALUDO, "REANUDAR").encode());
            return List.of();
        }
        List<Long> resumed = new ArrayList<>();
        for (var entry : grave.session().canvases().entrySet()) {
            entry.getValue().session(session);
            session.canvases().put(entry.getKey(), entry.getValue());
            resumed.add(entry.getKey());
        }
        session.ticket(sessions.newTicket());
        return resumed;
    }

    private static boolean covers(Canvas canvas, seurat.proto.Ranges ranges) {
        final boolean[] inside = {true};
        ranges.forEach(n -> {
            if (!canvas.book().contains(n)) {
                inside[0] = false;
            }
        });
        return inside[0];
    }
}
