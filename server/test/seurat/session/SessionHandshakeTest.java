package seurat.session;

import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.net.RecordingMapping;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgGaze;
import seurat.proto.MsgHandshake;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.store.WorkMeta;

public final class SessionHandshakeTest {
    public static void main(String[] args) throws Exception {
        testNormalHello();
        testResumeSuccess();
        testResumeRejection();
        testResumeAdoptsOnlyClaims();
        System.out.println("SessionHandshakeTest OK");
    }

    /** A reloaded page resumes with no claims: nothing is adopted, so no later audit can fail. */
    private static void testResumeAdoptsOnlyClaims() throws Exception {
        Sessions sessions = new Sessions();
        byte[] oldTicket = sessions.newTicket();
        Session oldSession = new Session(300, "alice", "autenticado", 256, ProtoCodes.CAP_REANUDAR,
                new RecordingMapping(), oldTicket);
        Canvas canvas = new Canvas(1, "w", null, new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2, 0, 2),
                new Concession(1, 0, 4, 1, 768, 36864, 120));
        canvas.book().log(new BrushId(1, 0, 0), 0, 2, 100, 1);
        canvas.session(oldSession);
        oldSession.canvases().put(1L, canvas);
        sessions.add(oldSession);
        sessions.retire(oldSession, 120_000_000_000L);
        byte[] newToken = Hex.unhex(sessions.issueToken("alice", "autenticado", 256, 60000));
        RecordingMapping mapping = new RecordingMapping();
        var queue = new LinkedBlockingQueue<byte[]>();
        var resumeReq = new MsgHandshake.ResumeRequest(300, oldTicket, List.of());
        queue.add(new Frame(FrameType.SALUDO, new MsgHandshake.Hello(1, 1, ProtoCodes.CAP_REANUDAR,
                256, newToken, resumeReq).encode()).encode());
        Session s = new SessionHandshake(mapping, queue, sessions, 768).hello();
        TestKit.check(s.canvases().isEmpty(), "unclaimed canvas not adopted");
        TestKit.check(mapping.control.size() == 1, "BIENVENIDA only, no CONCESION");
    }

    private static void testNormalHello() throws Exception {
        Sessions sessions = new Sessions();
        String hex = sessions.issueToken("alice", "autenticado", 256, 60000);
        byte[] tokenBytes = Hex.unhex(hex);

        RecordingMapping mapping = new RecordingMapping();
        var queue = new LinkedBlockingQueue<byte[]>();
        SessionHandshake handshake = new SessionHandshake(mapping, queue, sessions, 768);

        MsgHandshake.Hello hello = new MsgHandshake.Hello(1, 1, ProtoCodes.CAP_REANUDAR, 256, tokenBytes, null);
        queue.add(new Frame(FrameType.SALUDO, hello.encode()).encode());

        Session s = handshake.hello();
        TestKit.check(s != null && s.principal().equals("alice"), "session created");
        TestKit.check(mapping.control.size() == 1, "sent BIENVENIDA");
        Frame b = Frame.decode(ByteBuffer.wrap(mapping.control.get(0)));
        TestKit.check(b.type() == FrameType.BIENVENIDA, "is BIENVENIDA");
    }

    private static void testResumeSuccess() throws Exception {
        Sessions sessions = new Sessions();
        byte[] oldTicket = sessions.newTicket();
        RecordingMapping oldMapping = new RecordingMapping();
        Session oldSession = new Session(100, "alice", "autenticado", 256, ProtoCodes.CAP_REANUDAR, oldMapping, oldTicket);
        WorkMeta meta = new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2, 0, 2);
        Canvas canvas = new Canvas(1, "w", null, meta, new Concession(1, 0, 4, 1, 768, 36864, 120));
        canvas.book().log(new BrushId(1, 0, 0), 0, 2, 100, 1);
        canvas.session(oldSession);
        oldSession.canvases().put(1L, canvas);
        sessions.add(oldSession);
        sessions.retire(oldSession, 120_000_000_000L);

        String hexToken = sessions.issueToken("alice", "autenticado", 256, 60000);
        byte[] newToken = Hex.unhex(hexToken);

        RecordingMapping mapping = new RecordingMapping();
        var queue = new LinkedBlockingQueue<byte[]>();
        SessionHandshake handshake = new SessionHandshake(mapping, queue, sessions, 768);

        var claim = new MsgHandshake.Claim(1, Ranges.of(1));
        var resumeReq = new MsgHandshake.ResumeRequest(100, oldTicket, List.of(claim));
        MsgHandshake.Hello hello = new MsgHandshake.Hello(1, 1, ProtoCodes.CAP_REANUDAR, 256, newToken, resumeReq);
        queue.add(new Frame(FrameType.SALUDO, hello.encode()).encode());

        Session s = handshake.hello();
        TestKit.check(s != null, "resumed session");
        TestKit.check(mapping.control.size() == 2, "sent BIENVENIDA + CONCESION");
        Frame f0 = Frame.decode(ByteBuffer.wrap(mapping.control.get(0)));
        TestKit.check(f0.type() == FrameType.BIENVENIDA, "frame 0 is BIENVENIDA");
        Frame f1 = Frame.decode(ByteBuffer.wrap(mapping.control.get(1)));
        TestKit.check(f1.type() == FrameType.CONCESION, "frame 1 is CONCESION");
        var conc = MsgGaze.ConcessionMessage.parse(f1.payload());
        TestKit.check(conc.handle() == 1, "concession for handle 1");
    }

    private static void testResumeRejection() throws Exception {
        Sessions sessions = new Sessions();
        byte[] oldTicket = sessions.newTicket();
        RecordingMapping oldMapping = new RecordingMapping();
        Session oldSession = new Session(200, "alice", "autenticado", 256, ProtoCodes.CAP_REANUDAR, oldMapping, oldTicket);
        sessions.add(oldSession);
        sessions.retire(oldSession, 120_000_000_000L);

        String hexToken = sessions.issueToken("alice", "autenticado", 256, 60000);
        byte[] newToken = Hex.unhex(hexToken);

        RecordingMapping mapping = new RecordingMapping();
        var queue = new LinkedBlockingQueue<byte[]>();
        SessionHandshake handshake = new SessionHandshake(mapping, queue, sessions, 768);

        var claim = new MsgHandshake.Claim(1, Ranges.of(999));
        var resumeReq = new MsgHandshake.ResumeRequest(200, oldTicket, List.of(claim));
        MsgHandshake.Hello hello = new MsgHandshake.Hello(1, 1, ProtoCodes.CAP_REANUDAR, 256, newToken, resumeReq);
        queue.add(new Frame(FrameType.SALUDO, hello.encode()).encode());

        handshake.hello();
        TestKit.check(mapping.control.size() == 2, "sent ERROR 12 then BIENVENIDA");
        Frame f0 = Frame.decode(ByteBuffer.wrap(mapping.control.get(0)));
        TestKit.check(f0.type() == FrameType.ERROR, "frame 0 is ERROR");
    }
}
