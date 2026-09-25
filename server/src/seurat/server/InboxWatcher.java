package seurat.server;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardWatchEventKinds;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;
import seurat.observe.AuditLog;
import seurat.observe.Log;

/** Watches inbox directory and scans for incoming master images and archives. */
final class InboxWatcher {
    private final Path inbox;
    private final BiConsumer<String, Path> onMaster;
    private final Set<Path> seen = ConcurrentHashMap.newKeySet();

    InboxWatcher(Path inbox, BiConsumer<String, Path> onMaster) {
        this.inbox = inbox;
        this.onMaster = onMaster;
    }

    void start() {
        Thread.ofVirtual().start(() -> {
            try {
                scan(inbox);
                var watcher = inbox.getFileSystem().newWatchService();
                inbox.register(watcher, StandardWatchEventKinds.ENTRY_CREATE,
                        StandardWatchEventKinds.ENTRY_MODIFY);
                Log.info("ingest", "Inbox file watcher active on " + inbox.toAbsolutePath());
                for (;;) {
                    var key = watcher.take();
                    for (var event : key.pollEvents()) {
                        offerIfMaster(event.context().toString());
                    }
                    key.reset();
                }
            } catch (Throwable ex) {
                Log.error("ingest", "Inbox watcher error: " + ex.getMessage(), ex);
                try {
                    AuditLog.alert("inbox watch failed: " + ex.getMessage());
                } catch (Throwable ignored) {
                }
            }
        });
    }

    void scan(Path root) {
        if (!Files.exists(root)) return;
        try (var walk = Files.walk(root)) {
            for (Path file : walk.filter(Files::isRegularFile).toList()) {
                String rel = root.relativize(file).toString().replace('\\', '/');
                if (rel.contains(".d/") || rel.startsWith(".d/")) continue;
                String lower = file.getFileName().toString().toLowerCase();
                if (isMaster(lower)) {
                    submit(rel.replaceAll("\\.[^.]+$", ""), file);
                }
            }
        } catch (Throwable ex) {
            Log.error("ingest", "Scan failed on " + root + ": " + ex.getMessage());
        }
    }

    private void offerIfMaster(String name) {
        if (name.endsWith(".d") || name.endsWith(".tmp") || name.contains(".d/")) return;
        String lower = name.toLowerCase();
        if (isMaster(lower)) {
            submit(name.replaceAll("\\.[^.]+$", ""), inbox.resolve(name));
        }
    }

    private void submit(String id, Path file) {
        if (!seen.add(file.toAbsolutePath().normalize())) return;
        onMaster.accept(id, file);
    }

    void done(Path file) {
        seen.remove(file.toAbsolutePath().normalize());
    }

    private static boolean isMaster(String lower) {
        return lower.endsWith(".png") || lower.endsWith(".jpg")
                || lower.endsWith(".jpeg") || lower.endsWith(".tif")
                || lower.endsWith(".zip");
    }
}
