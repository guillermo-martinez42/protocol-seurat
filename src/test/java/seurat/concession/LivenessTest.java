package seurat.concession;

import java.nio.ByteBuffer;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.net.RecordingMapping;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgHandshake;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Session;
import seurat.session.Sessions;
import seurat.store.WorkMeta;

public final class LivenessTest {
    public static void main(String[] args) throws Exception {
        testHeartbeatTimeout();
        testRenewalAck();
        System.out.println("LivenessTest OK");
    }

    private static void testHeartbeatTimeout() throws Exception {
        Sessions sessions = new Sessions();
        RecordingMapping mapping = new RecordingMapping();
        Session s = new Session(1, "alice", "autenticado", 256, 0, mapping, new byte[32]);
        // Set last activity to 46 seconds ago
        s.lastActivityNs = System.nanoTime() - 46_000_000_000L;
        sessions.add(s);

        GrantController grants = new GrantController(null, null, sessions);
        Liveness liveness = new Liveness(grants, sessions);
        liveness.tick();

        TestKit.check(sessions.find(1) == null, "hung session removed from live");
        TestKit.check(!mapping.control.isEmpty(), "error frame sent");
        Frame err = Frame.decode(ByteBuffer.wrap(mapping.control.get(0)));
        TestKit.check(err.type() == FrameType.ERROR, "is ERROR frame");
        var pe = MsgHandshake.ProtocolError.parse(err.payload());
        TestKit.check(pe.code() == ProtoCodes.ERR_PROTOCOLO, "ERR_PROTOCOLO");
    }

    private static void testRenewalAck() throws Exception {
        Sessions sessions = new Sessions();
        RecordingMapping mapping = new RecordingMapping();
        Session s = new Session(2, "alice", "autenticado", 256, 0, mapping, new byte[32]);
        WorkMeta meta = new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2, 0, 2);
        Canvas canvas = new Canvas(1, "w", null, meta, new Concession(1, 0, 4, 1, 768, 36864, 120));
        canvas.book().log(new BrushId(1, 0, 0), 0, 2, 100, 1);
        canvas.session(s);
        s.canvases().put(1L, canvas);
        sessions.add(s);

        GrantController grants = new GrantController(null, null, sessions);
        Liveness liveness = new Liveness(grants, sessions);

        // Force renew tick
        canvas.renewNs = System.nanoTime() - 65_000_000_000L;
        liveness.tick();

        TestKit.check(!mapping.control.isEmpty(), "RENOVAR sent");
        Frame renewFrame = Frame.decode(ByteBuffer.wrap(mapping.control.get(0)));
        TestKit.check(renewFrame.type() == FrameType.RENOVAR, "is RENOVAR");

        // Client acknowledges renewal order
        long now = System.nanoTime();
        canvas.acknowledgeRenewal(1, now, 120_000_000_000L, 1_000_000_000L);
        // Delivery 1 deadline was extended
        Ranges expired = canvas.book().pruneExpired(now + 60_000_000_000L);
        TestKit.check(expired.isEmpty(), "delivery 1 still valid within lease");
    }
}
