package seurat.catalog;

import java.util.HashMap;
import java.util.Map;
import seurat.store.BrushStore;
import seurat.store.WorkMeta;

/** One work: meta + ceilings per role + live store handle. */
public final class WorkRecord {
    public static final String ANONYMOUS = "anonimo";
    public static final String AUTHENTICATED = "autenticado";
    public static final String PRIVILEGED = "privilegiado";

    public volatile WorkMeta meta;
    public final Map<String, long[]> ceilings = new HashMap<>();
    public volatile BrushStore store;

    public WorkRecord(WorkMeta meta) {
        this.meta = meta;
        // Every role reaches full detail when zoomed in (level 0, all 4 bands); the budget's
        // band rate limit and lossy level 0 keep the whole image from ever leaving at master
        // quality. PUT .../politica can still lower a work's ceiling per role.
        ceilings.put(ANONYMOUS, new long[]{0, 4});
        ceilings.put(AUTHENTICATED, new long[]{0, 4});
        ceilings.put(PRIVILEGED, new long[]{0, 4});
    }

    public long[] ceiling(String role) {
        return ceilings.getOrDefault(role, ceilings.get(ANONYMOUS));
    }
}
