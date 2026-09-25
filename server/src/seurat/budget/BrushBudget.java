package seurat.budget;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import seurat.codec.BrushId;
import seurat.concession.Concessions;
import seurat.store.WorkMeta;

/**
 * Brush budget per (principal, work): token buckets for fine strata +
 * persistent coverage map (4 bits per E0/E1 brush). Redelivery is free.
 */
public final class BrushBudget {
    private final Path base;
    private final Map<String, TokenBucket> buckets = new ConcurrentHashMap<>();
    private final Map<String, Coverage> coverages = new ConcurrentHashMap<>();

    public BrushBudget(Path base) throws IOException {
        this.base = base;
        Files.createDirectories(base);
    }

    public boolean consume(String principal, String work, BrushId p, int from,
            int through, String role, WorkMeta meta) {
        int stratum = p.stratum();
        if (stratum > 1 || stratum >= Concessions.sketchMin(meta.strata() - 1)) {
            return true;
        }
        try {
            Coverage seen = coverage(principal, work, meta);
            int newBands = Math.max(0, through - Math.max(from, seen.get(p)));
            if (newBands == 0) {
                return true;
            }
            if (!bucket(principal, work, stratum, role).take(newBands)) {
                return false;
            }
            seen.set(p, through);
            return true;
        } catch (IOException ex) {
            seurat.observe.Log.warn("budget", "coverage unavailable for " + work + ": " + ex);
            return false;
        }
    }

    /**
     * Band rate limit per role: generous enough to zoom anywhere at full detail, slow
     * enough that sweeping all of level 0 takes hours. (A coverage-percentage cap was
     * dropped: every anonymous viewer shares one principal, so it locked out everyone.)
     */
    private TokenBucket bucket(String principal, String work, int stratum, String role) {
        boolean priv = role.equals(seurat.catalog.WorkRecord.PRIVILEGED);
        boolean auth = role.equals(seurat.catalog.WorkRecord.AUTHENTICATED);
        long capacity = priv ? 200_000 : auth ? 100_000 : 50_000;
        double rate = priv ? 1_000 : auth ? 400 : 200;
        return buckets.computeIfAbsent(principal + "\0" + work + "\0" + stratum,
                k -> new TokenBucket(capacity, rate));
    }

    private Coverage coverage(String principal, String work, WorkMeta meta)
            throws IOException {
        String k = principal + "\0" + work;
        Coverage c = coverages.get(k);
        if (c == null) {
            Path file = base.resolve(principal).resolve(work + ".bits");
            Files.createDirectories(file.getParent()); // work ids may nest: img-peq/name
            c = new Coverage(file, meta);
            coverages.put(k, c);
        }
        return c;
    }

}
