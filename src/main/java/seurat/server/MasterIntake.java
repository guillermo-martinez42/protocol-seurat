package seurat.server;

import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executor;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.concession.GrantController;
import seurat.config.SeuratConfig;
import seurat.ingest.IngestJob;
import seurat.observe.AuditLog;
import seurat.observe.Log;
import seurat.proto.ProtoCodes;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Session;
import seurat.session.Sessions;

/** Master intake: inbox watch, zip unpack, single ingest, ed1->ed2 swap. */
public final class MasterIntake {
    private final Catalog catalog;
    private final Sessions sessions;
    private final GrantController grants;
    private final SeuratConfig config;
    private final Executor ingest;

    public MasterIntake(Catalog catalog, Sessions sessions, GrantController grants,
            SeuratConfig config, Executor ingest) {
        this.catalog = catalog;
        this.sessions = sessions;
        this.grants = grants;
        this.config = config;
        this.ingest = ingest;
    }

    public void offer(String id, Path file) {
        Log.info("ingest", "Queueing ingest for '" + id + "' (" + file.getFileName() + ")");
        ingest.execute(() -> launch(id, file));
    }

    private void launch(String id, Path file) {
        try {
            if (file.toString().endsWith(".zip")) {
                Log.info("ingest", "Unpacking zip archive: " + file.getFileName());
                for (Path img : ZipUnpacker.unpack(file, this::isLista)) {
                    String name = img.getFileName().toString().replaceAll("\\.[^.]+$", "");
                    new IngestJob(name, name, img, config.works, catalog,
                            () -> substitute(name)).run();
                }
                return;
            }
            String name = id.replaceAll("\\.[^.]+$", "");
            if (isLista(name)) {
                Log.info("ingest", "Work already completed, skipping: " + name);
                return;
            }
            new IngestJob(name, name, file, config.works, catalog,
                    () -> substitute(name)).run();
        } catch (Exception ex) {
            Log.error("ingest", "Ingest failed for " + id + ": " + ex.getMessage(), ex);
            AuditLog.alert("ingest failed " + id + ": " + ex.getMessage());
        }
    }

    private boolean isLista(String id) {
        WorkRecord r = catalog.get(id);
        return r != null && r.meta != null && r.meta.state() == ProtoCodes.ST_LISTA;
    }

    /** Edition swap: point canvases at ed2, re-issue concession, replan without withdrawing. */
    private void substitute(String id) {
        WorkRecord work = catalog.get(id);
        if (work == null) {
            return;
        }
        Log.info("ingest", "Swapping edition for work '" + id + "' across active canvases");
        for (Session session : sessions.all()) {
            for (Canvas canvas : session.canvases().values()) {
                if (!canvas.workId().equals(id)) continue;
                canvas.setStore(work.store, work.meta);
                long[] c = work.ceiling(session.role());
                Concession prev = canvas.concession();
                canvas.setConcession(new Concession(prev.epoch() + 1, (int) c[0], (int) c[1],
                        ProtoCodes.MOT_POLITICA, prev.maxBrushes(), prev.maxKiB(), prev.leaseS()));
                if (canvas.gaze() != null) grants.gaze(session, canvas, canvas.gaze());
                else grants.open(session, canvas);
            }
        }
    }

    public void watch() {
        Thread.ofVirtual().start(() -> {
            try {
                var watcher = config.inbox.getFileSystem().newWatchService();
                config.inbox.register(watcher,
                        java.nio.file.StandardWatchEventKinds.ENTRY_CREATE);
                Log.info("ingest", "Inbox file watcher active on " + config.inbox.toAbsolutePath());
                try (DirectoryStream<Path> existing = Files.newDirectoryStream(config.inbox)) {
                    for (Path file : existing) {
                        offerIfMaster(file.getFileName().toString());
                    }
                }
                for (;;) {
                    var key = watcher.take();
                    for (var event : key.pollEvents()) {
                        offerIfMaster(event.context().toString());
                    }
                    key.reset();
                }
            } catch (Exception ex) {
                Log.error("ingest", "Inbox watcher error: " + ex.getMessage(), ex);
                AuditLog.alert("inbox watch failed: " + ex.getMessage());
            }
        });
    }

    private void offerIfMaster(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".tif")
                || lower.endsWith(".zip")) {
            Log.info("ingest", "Detected master image in inbox: " + name);
            offer(name, config.inbox.resolve(name));
        }
    }
}
