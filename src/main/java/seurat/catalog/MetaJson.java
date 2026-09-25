package seurat.catalog;

import java.util.HashMap;
import java.util.Map;
import seurat.store.WorkMeta;

/** Minimal meta.json reader/writer. No dependencies. */
final class MetaJson {
    private MetaJson() {}

    static String write(WorkRecord work) {
        WorkMeta m = work.meta;
        return "{\"id\":\"" + m.id() + "\",\"name\":\"" + m.name()
                + "\",\"width\":" + m.width() + ",\"height\":" + m.height()
                + ",\"side\":" + m.side() + ",\"strata\":" + m.strata()
                + ",\"state\":" + m.state() + ",\"edition\":" + m.edition() + "}";
    }

    static WorkMeta read(String id, String json) {
        Map<String, String> m = new HashMap<>();
        for (String part : json.replaceAll("[{}\"]", "").split(",")) {
            String[] kv = part.split(":", 2);
            if (kv.length == 2) {
                m.put(kv[0].trim(), kv[1].trim());
            }
        }
        return new WorkMeta(m.getOrDefault("id", id), m.getOrDefault("name", id),
                Integer.parseInt(m.getOrDefault("width", "0")),
                Integer.parseInt(m.getOrDefault("height", "0")),
                Integer.parseInt(m.getOrDefault("side", "256")),
                Integer.parseInt(m.getOrDefault("strata", "0")),
                Integer.parseInt(m.getOrDefault("state", "3")),
                Long.parseLong(m.getOrDefault("edition", "2")), 0, 2);
    }
}
