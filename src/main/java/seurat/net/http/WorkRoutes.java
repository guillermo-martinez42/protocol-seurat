package seurat.net.http;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.config.SeuratConfig;

/** PUT/DELETE /seurat/v1/obras/{id} + PUT .../politica. Admin only. */
final class WorkRoutes {
    private final Catalog catalog;
    private final SeuratConfig config;
    private final BiConsumer<String, Path> onMaster;
    private final Consumer<String> onPolicy;
    private final Consumer<String> onWithdraw;

    WorkRoutes(Catalog catalog, SeuratConfig config, BiConsumer<String, Path> onMaster,
            Consumer<String> onPolicy, Consumer<String> onWithdraw) {
        this.catalog = catalog;
        this.config = config;
        this.onMaster = onMaster;
        this.onPolicy = onPolicy;
        this.onWithdraw = onWithdraw;
    }

    HttpSurface.Response route(HttpSurface.Request req) throws Exception {
        String rest = req.path().substring("/seurat/v1/obras/".length());
        int slash = rest.indexOf('/');
        String id = slash < 0 ? rest : rest.substring(0, slash);
        String tail = slash < 0 ? "" : rest.substring(slash);
        if (!req.headers().getOrDefault("x-admin-token", "").equals(config.adminToken)) {
            return HttpSurface.json(403, "{\"error\":\"admin\"}");
        }
        if (req.method().equals("PUT") && tail.isEmpty()) {
            Path file = config.inbox.resolve(id);
            Files.write(file, req.body());
            onMaster.accept(id, file);
            return HttpSurface.json(202, "{\"estado\":\"recibiendo\"}");
        }
        if (req.method().equals("PUT") && tail.equals("/politica")) {
            applyPolicy(id, new String(req.body(), StandardCharsets.UTF_8));
            onPolicy.accept(id);
            return HttpSurface.json(200, "{\"ok\":true}");
        }
        if (req.method().equals("DELETE") && tail.isEmpty()) {
            onWithdraw.accept(id);
            return HttpSurface.json(200, "{\"ok\":true}");
        }
        return HttpSurface.json(404, "{\"error\":\"no existe\"}");
    }

    private void applyPolicy(String id, String body) {
        WorkRecord work = catalog.get(id);
        if (work == null) {
            return;
        }
        for (String role : new String[]{WorkRecord.ANONYMOUS, WorkRecord.AUTHENTICATED,
                WorkRecord.PRIVILEGED}) {
            long[] pair = HttpSurface.pair(body, role);
            if (pair != null) {
                work.ceilings.put(role, pair);
            }
        }
    }
}
