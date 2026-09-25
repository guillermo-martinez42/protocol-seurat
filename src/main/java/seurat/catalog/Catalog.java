package seurat.catalog;

import java.io.IOException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import seurat.ingest.IngestJob;
import seurat.proto.MsgCatalog;
import seurat.proto.ProtoCodes;
import seurat.store.BrushStore;
import seurat.store.FileBrushStore;

/** id -> work map + meta.json. Pushes OBRA to sessions (Observer). */
public final class Catalog {
    private final Path worksDir;
    private final Map<String, WorkRecord> records = new ConcurrentHashMap<>();
    private final List<Consumer<MsgCatalog.WorkMessage>> listeners =
            new CopyOnWriteArrayList<>();

    public Catalog(Path worksDir) throws IOException {
        this.worksDir = worksDir;
        Files.createDirectories(worksDir);
    }

    public void observe(Consumer<MsgCatalog.WorkMessage> listener) {
        listeners.add(listener);
    }

    private void emit(MsgCatalog.WorkMessage message) {
        listeners.forEach(listener -> listener.accept(message));
    }

    public void register(WorkRecord work) throws IOException {
        records.put(work.meta.id(), work);
        persist(work);
        emit(message(work, ProtoCodes.OBRA_ALTA, 0));
    }

    public void progress(String id, int pct) {
        WorkRecord work = records.get(id);
        if (work != null) {
            emit(message(work, ProtoCodes.OBRA_ESTADO, pct));
        }
    }

    public void sketch(String id, BrushStore store, int state, long edition) {
        WorkRecord work = records.get(id);
        if (work != null) {
            work.store = store;
            work.meta = new seurat.store.WorkMeta(work.meta.id(), work.meta.name(),
                    work.meta.width(), work.meta.height(), work.meta.side(),
                    work.meta.strata(), state, edition, work.meta.ceilingStratum(),
                    work.meta.ceilingBands());
            try {
                persist(work);
            } catch (IOException ignored) {
            }
            emit(message(work, ProtoCodes.OBRA_ESTADO, 100));
        }
    }

    public void list(String id) {
        WorkRecord work = records.get(id);
        if (work != null) {
            emit(message(work, ProtoCodes.OBRA_EDICION, 100));
        }
    }

    public void withdraw(String id) {
        WorkRecord work = records.remove(id);
        if (work != null) {
            emit(new MsgCatalog.WorkMessage(ProtoCodes.OBRA_BAJA, ProtoCodes.ST_RETIRADA,
                    0, work.meta.edition(), work.meta.width(), work.meta.height(),
                    work.meta.strata(), id, work.meta.name()));
        }
    }

    public WorkRecord get(String id) {
        return records.get(id);
    }

    public Iterable<WorkRecord> all() {
        return records.values();
    }

    /** Restart recovery: rebuild LISTA stores, truncate to the index. */
    public void load() throws IOException {
        if (!Files.exists(worksDir)) return;
        try (var walk = Files.walk(worksDir)) {
            for (Path meta : walk.filter(p -> p.getFileName().toString().equals("meta.json")).toList()) {
                Path dir = meta.getParent();
                if (dir.getFileName().toString().equals("ed1")) continue;
                String defaultId = worksDir.relativize(dir).toString().replace('\\', '/');
                var info = MetaJson.read(defaultId, Files.readString(meta));
                WorkRecord work = new WorkRecord(info);
                if (info.strata() > 0) {
                    int top = info.strata() - 1;
                    int[] nx = new int[top];
                    int[] ny = new int[top];
                    for (int stratum = 0; stratum < top; stratum++) {
                        nx[stratum] = IngestJob.div256(IngestJob.padTo(info.width(), top)
                                >> stratum);
                        ny[stratum] = IngestJob.div256(IngestJob.padTo(info.height(), top)
                                >> stratum);
                    }
                    Path storeDir = info.edition() == 1 && Files.exists(dir.resolve("ed1"))
                            ? dir.resolve("ed1")
                            : dir;
                    work.store = new FileBrushStore(storeDir, info, nx, ny);
                }
                records.put(info.id(), work);
            }
        }
    }

    private MsgCatalog.WorkMessage message(WorkRecord work, int event, int progress) {
        return new MsgCatalog.WorkMessage(event, work.meta.state(), progress,
                work.meta.edition(), work.meta.width(), work.meta.height(),
                work.meta.strata(), work.meta.id(), work.meta.name());
    }

    private void persist(WorkRecord work) throws IOException {
        Path dir = worksDir.resolve(work.meta.id());
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("meta.json"), MetaJson.write(work));
    }
}
