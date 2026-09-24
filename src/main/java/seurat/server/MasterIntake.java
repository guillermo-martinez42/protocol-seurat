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
        ingest.execute(() -> launch(id, file));
    }

    private void launch(String id, Path file) {
        try {
            if (file.toString().endsWith(".zip")) {
                for (Path img : unzip(file)) {
                    String name = img.getFileName().toString().replaceAll("\\.[^.]+$", "");
                    new IngestJob(name, name, img, config.works, catalog,
                            () -> substitute(name)).run();
                }
                return;
            }
            String name = id.replaceAll("\\.[^.]+$", "");
            new IngestJob(name, name, file, config.works, catalog,
                    () -> substitute(name)).run();
        } catch (Exception ex) {
            AuditLog.alert("ingest failed " + id + ": " + ex.getMessage());
        }
    }

    private static java.util.List<Path> unzip(Path zip) throws Exception {
        Path dir = zip.getParent().resolve(zip.getFileName() + ".d");
        Files.createDirectories(dir);
        java.util.List<Path> list = new java.util.ArrayList<>();
        try (var in = new java.util.zip.ZipFile(zip.toFile())) {
            var entries = in.entries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                String base = Path.of(entry.getName()).getFileName().toString();
                String lower = base.toLowerCase();
                if (!lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".tif")) {
                    continue;
                }
                Path out = dir.resolve(base);
                if (!Files.exists(out) || Files.size(out) != entry.getSize()) {
                    try (var is = in.getInputStream(entry)) {
                        Files.copy(is, out, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    }
                }
                list.add(out);
            }
        }
        if (list.isEmpty()) {
            throw new java.io.IOException("no images in zip");
        }
        list.sort(java.util.Comparator.comparingLong(p -> {
            try { return Files.size(p); } catch (Exception e) { return 0L; }
        }));
        return list;
    }

    /** Edition swap: point canvases at ed2, re-issue concession, replan without withdrawing. */
    private void substitute(String id) {
        WorkRecord work = catalog.get(id);
        if (work == null) {
            return;
        }
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
                AuditLog.alert("inbox watch failed: " + ex.getMessage());
            }
        });
    }

    private void offerIfMaster(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".tif")
                || lower.endsWith(".zip")) {
            offer(name, config.inbox.resolve(name));
        }
    }
}
