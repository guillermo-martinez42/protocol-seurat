package seurat.net.http;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Static root: client/dist. No CDN. */
final class StaticFiles {
    private final Path root;

    StaticFiles(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    byte[] get(String path) throws IOException {
        String clean = path.startsWith("/") ? path.substring(1) : path;
        String rel = clean.isEmpty() ? "index.html" : clean;
        Path file = root.resolve(rel).normalize();
        if (!file.startsWith(root) || !Files.isRegularFile(file)) {
            return null;
        }
        return Files.readAllBytes(file);
    }

    static String contentType(String path) {
        if (path.endsWith(".html")) {
            return "text/html; charset=utf-8";
        }
        if (path.endsWith(".js")) {
            return "text/javascript; charset=utf-8";
        }
        if (path.endsWith(".css")) {
            return "text/css; charset=utf-8";
        }
        if (path.endsWith(".json")) {
            return "application/json";
        }
        if (path.endsWith(".png")) {
            return "image/png";
        }
        if (path.endsWith(".svg")) {
            return "image/svg+xml";
        }
        if (path.endsWith(".woff2")) {
            return "font/woff2";
        }
        return "application/octet-stream";
    }
}
