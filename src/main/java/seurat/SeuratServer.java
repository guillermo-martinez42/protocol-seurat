package seurat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.BlockingQueue;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.concession.GrantController;
import seurat.concession.Liveness;
import seurat.concession.PolicySync;
import seurat.config.SeuratConfig;
import seurat.server.MasterIntake;
import seurat.net.SocketServer;
import seurat.net.WsMapping;
import seurat.net.http.HttpSurface;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgHandshake;
import seurat.regulate.Regulator;
import seurat.session.Canvas;
import seurat.session.Easel;
import seurat.session.Session;
import seurat.session.Sessions;

/** Wiring only: config, catalog, painter, mappings, timers. */
public final class SeuratServer {
    public static void main(String[] args) throws Exception {
        Path base = Path.of(args.length > 0 ? args[0] : ".");
        SeuratConfig config = SeuratConfig.load(base.resolve("seurat.conf"));
        Catalog catalog = new Catalog(config.works);
        catalog.load();
        BrushBudget budget = new BrushBudget(config.coverage);
        Regulator regulator = new Regulator();
        Metrics metrics = new Metrics();
        Painter painter = new Painter(regulator, budget, metrics);
        Sessions sessions = new Sessions();
        GrantController grants = new GrantController(catalog, painter, sessions);
        Liveness liveness = new Liveness(grants, sessions);
        PolicySync policies = new PolicySync(grants);
        Thread.ofPlatform().name("painter").daemon(true).start(painter);
        var ingest = Executors.newSingleThreadExecutor(Thread.ofVirtual().factory());
        MasterIntake intake = new MasterIntake(catalog, sessions, grants, config, ingest);
        HttpSurface http = new HttpSurface(staticRoot(base), sessions, catalog, config,
                intake::offer,
                id -> applyPolicy(catalog, sessions, policies, id),
                id -> withdraw(catalog, sessions, grants, config, id));
        intake.watch();
        ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();
        clock.scheduleAtFixedRate(() -> regulator.tick(sessions.all()), 250, 250, TimeUnit.MILLISECONDS);
        clock.scheduleAtFixedRate(liveness::tick, 1, 1, TimeUnit.SECONDS);
        clock.scheduleAtFixedRate(() -> heartbeat(sessions), 15, 15, TimeUnit.SECONDS);
        new SocketServer(config.httpPort, http, (WsMapping mapping,
                BlockingQueue<byte[]> control) -> {
            Thread.ofVirtual().start(mapping::pump);
            Thread.ofVirtual().start(new Easel(mapping, control, sessions, catalog,
                    grants, painter, config.sessionMaxBrushes));
        }).start();
    }

    private static Path staticRoot(Path base) {
        Path dist = base.resolve("client/dist");
        if (Files.exists(dist.resolve("index.html"))) {
            return dist;
        }
        return base.resolve("web");
    }

    private static void applyPolicy(Catalog catalog, Sessions sessions,
            PolicySync policies, String id) {
        WorkRecord work = catalog.get(id);
        if (work == null) {
            return;
        }
        for (Session session : sessions.all()) {
            for (Canvas canvas : session.canvases().values()) {
                if (canvas.workId().equals(id)) {
                    policies.apply(canvas, work.ceiling(session.role()));
                }
            }
        }
    }

    private static void withdraw(Catalog catalog, Sessions sessions,
            GrantController grants, SeuratConfig config, String id) {
        catalog.withdraw(id);
        for (Session session : sessions.all()) {
            for (Canvas canvas : new ArrayList<>(session.canvases().values())) {
                if (canvas.workId().equals(id)) {
                    grants.withdraw(canvas);
                }
            }
        }
        deleteRecursively(config.works.resolve(id));
    }

    private static void heartbeat(Sessions sessions) {
        for (Session session : sessions.all()) {
            try {
                session.mapping().sendControl(new Frame(FrameType.LATIDO,
                        new MsgHandshake.Heartbeat(System.nanoTime()).encode()).encode());
            } catch (Exception ignored) {
            }
        }
    }

    private static void deleteRecursively(Path dir) {
        try {
            if (!Files.exists(dir)) {
                return;
            }
            try (var walk = Files.walk(dir)) {
                var gone = walk.sorted(java.util.Comparator.reverseOrder()).toList();
                for (Path victim : gone) {
                    Files.deleteIfExists(victim);
                }
            }
        } catch (Exception ignored) {
        }
    }

}
