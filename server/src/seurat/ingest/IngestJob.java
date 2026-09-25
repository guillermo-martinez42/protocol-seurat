package seurat.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.codec.Quant;
import seurat.observe.AuditLog;
import seurat.observe.Log;
import seurat.proto.ProtoCodes;
import seurat.store.FileBrushStore;
import seurat.store.WorkMeta;

/**
 * Single sequential pass: 256-row bands, per-stratum int16 accumulators,
 * pool of N-1 for brush encode. ed2 at close + fsync. No ed1 sketch: PNG
 * carries no overview (spec 7.1 step 3), so the work opens once LISTA.
 */
public final class IngestJob implements Runnable {
    private final String id;
    private final String name;
    private final Path master;
    private final Path worksDir;
    private final Catalog catalog;
    private final Runnable onReady;

    public IngestJob(String id, String name, Path master, Path worksDir,
            Catalog catalog, Runnable onReady) {
        this.id = id;
        this.name = name;
        this.master = master;
        this.worksDir = worksDir;
        this.catalog = catalog;
        this.onReady = onReady;
    }

    @Override
    public void run() {
        try {
            if (catalog.isCompleted(id)) {
                Log.info("ingest", "Work already completed, skipping: " + id);
                return;
            }
            Log.info("ingest", "Ingest started for '" + id + "' [" + name + "] from " + master.getFileName());
            catalog.register(new WorkRecord(new WorkMeta(id, name, 0, 0, 256, 0,
                    ProtoCodes.ST_RECIBIENDO, 1, 0, 2)));
            try (PngReader reader = new PngReader(master)) {
                int w = reader.width();
                int h = reader.height();
                int top = topLevels(w, h);
                Log.info("ingest", "Work '" + id + "' dimensions: " + w + "x" + h + ", strata=" + (top + 1));
                WorkRecord work = catalog.get(id);
                work.meta = new WorkMeta(id, name, w, h, 256, top + 1,
                        ProtoCodes.ST_PINTANDO, 1, 0, 2);
                FileBrushStore ed2 = store(top, w, h);
                new ImagePass(id, catalog, ed2, top, w, h, worksDir).run(reader);
                ed2.close();
                catalog.sketch(id, ed2, ProtoCodes.ST_LISTA, 2);
                catalog.list(id);
                Log.info("ingest", "Work '" + id + "' ed2 pyramid completed, work ready (ST_LISTA)");
            }
            onReady.run();
        } catch (Throwable ex) { // OutOfMemoryError included: never leave a work stuck mid-pass
            Log.error("ingest", "Ingest failed for '" + id + "': " + ex.getMessage(), ex);
            try {
                AuditLog.alert("ingest failed " + id + ": " + ex.getMessage());
            } catch (Throwable ignored) {
            }
            WorkRecord work = catalog.get(id);
            if (work != null) {
                catalog.sketch(id, work.store, ProtoCodes.ST_FALLIDA, work.meta.edition());
            }
        }
    }

    public static int topLevels(int w, int h) {
        int biggest = Math.max(w, h);
        int level = 0;
        while ((256 << level) < biggest) {
            level++;
        }
        return level;
    }

    public static int padTo(int v, int top) {
        return ((v + (1 << top) - 1) >> top) << top;
    }

    private FileBrushStore store(int top, int w, int h) throws Exception {
        Path dir = worksDir.resolve(id);
        int levels = top + 1;
        int[] nx = new int[levels];
        int[] ny = new int[levels];
        for (int stratum = 0; stratum < levels; stratum++) {
            nx[stratum] = div256(padTo(w, top) >> stratum);
            ny[stratum] = div256(padTo(h, top) >> stratum);
        }
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("quant"), Integer.toString(Quant.TABLE)); // FileBrushStore reads it
        return new FileBrushStore(dir,
                new WorkMeta(id, name, w, h, 256, top + 1, 0, 2, 0, 2), nx, ny);
    }

    public static int div256(int v) {
        return (v + 255) / 256;
    }
}
