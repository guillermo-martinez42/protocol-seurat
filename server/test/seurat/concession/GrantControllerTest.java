package seurat.concession;

import java.nio.file.Files;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.net.RecordingMapping;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.FatalProtocol;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgAudit;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.regulate.Regulator;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Session;
import seurat.session.Sessions;
import seurat.store.WorkMeta;

/** Rights: narrow ordering, exact confirm, mismatch fatal, audit compare. */
public final class GrantControllerTest {
    public static void main(String[] args) throws Exception {
        happyPath();
        mismatchFatal();
        audit();
        System.out.println("GrantControllerTest OK");
    }

    static class Setup {
        Sessions sessions;
        GrantController grants;
        Session session;
        Canvas canvas;
        RecordingMapping mapping;
    }

    static Setup setup() throws Exception {
        Setup s = new Setup();
        var root = Files.createTempDirectory("grants-test");
        s.sessions = new Sessions();
        Catalog catalog = new Catalog(root.resolve("obras"));
        var meta = new WorkMeta("w", "w", 512, 384, 256, 2, 3, 2, 0, 2);
        var work = new WorkRecord(meta);
        var store = new TestKit.FixedStore(meta);
        for (int bx = 0; bx < 2; bx++) {
            for (int by = 0; by < 2; by++) {
                store.put(new BrushId(0, bx, by), new byte[]{1}, new byte[]{2},
                        new byte[]{3}, new byte[]{4});
            }
        }
        work.store = store;
        catalog.register(work);
        var painter = new Painter(new Regulator(), new BrushBudget(root.resolve("cov")),
                new Metrics());
        s.mapping = new RecordingMapping();
        s.grants = new GrantController(catalog, painter, s.sessions);
        s.session = new Session(1, "p", WorkRecord.AUTHENTICATED, 256, 3, s.mapping,
                new byte[32]);
        s.sessions.add(s.session);
        s.canvas = new Canvas(1, "w", store, meta,
                new Concession(1, 0, 2, 1, 768, 36864, 120));
        s.canvas.session(s.session);
        s.session.canvases().put(1L, s.canvas);
        for (long n = 1; n <= 256; n++) {
            s.canvas.book().log(new BrushId(1, (int) (n % 64), (int) (n / 64)), 0, 4,
                    10, 2);
        }
        return s;
    }

    private static void happyPath() throws Exception {
        Setup s = setup();
        Concession current = s.canvas.concession();
        s.grants.narrow(s.canvas,
                new Concession(2, 1, 4, 2, current.maxBrushes(), current.maxKiB(), 120),
                Concessions.lowStratum(1),
                MsgLoans.Scrape.lowStratum(1, 0, 2, 0, 1));
        TestKit.check(s.canvas.concession().epoch() == 2, "epoch bumped");
        TestKit.check(s.canvas.pendingOrders().size() == 1, "order pending");
        TestKit.check(controlTypes(s).contains(FrameType.CONCESION), "CONCESION first");
        var order = s.canvas.pendingOrders().get(0);
        Ranges.Builder keep = new Ranges.Builder();
        keep.addRange(1, 256);
        var scraped = new MsgLoans.Scraped(1, order.order(), 2, order.through(), 0, 0,
                keep.build());
        s.grants.confirm(s.canvas, scraped);
        TestKit.check(s.canvas.pendingOrders().isEmpty(), "order resolved");
    }

    private static java.util.List<Long> controlTypes(Setup s) {
        var out = new java.util.ArrayList<Long>();
        for (byte[] frame : s.mapping.control) {
            out.add(Frame.decode(java.nio.ByteBuffer.wrap(frame)).type());
        }
        return out;
    }

    private static void mismatchFatal() throws Exception {
        Setup s = setup();
        Concession current = s.canvas.concession();
        s.grants.narrow(s.canvas,
                new Concession(2, 1, 4, 2, current.maxBrushes(), current.maxKiB(), 120),
                Concessions.lowStratum(1),
                MsgLoans.Scrape.lowStratum(1, 0, 2, 0, 1));
        var order = s.canvas.pendingOrders().get(0);
        var scraped = new MsgLoans.Scraped(1, order.order(), 2, order.through(), 0, 0,
                Ranges.of(1, 2, 3));
        try {
            s.grants.confirm(s.canvas, scraped);
            throw new AssertionError("expected ERROR 7");
        } catch (FatalProtocol fail) {
            TestKit.check(fail.code == ProtoCodes.ERR_POSESION, "ERROR 7");
        }
    }

    private static void audit() throws Exception {
        Setup s = setup();
        var numbers = s.canvas.book().numbersThrough(256);
        s.grants.audit(s.canvas,
                new MsgAudit.Inventory(1, 9, 256, 256, 1000, numbers));
        try {
            s.grants.audit(s.canvas,
                    new MsgAudit.Inventory(1, 10, 256, 256, 1000, Ranges.of(1)));
            throw new AssertionError("expected audit fatal");
        } catch (FatalProtocol fail) {
            TestKit.check(fail.code == ProtoCodes.ERR_POSESION, "audit ERROR 7");
        }
    }
}
