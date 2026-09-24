package seurat.budget;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import seurat.codec.BrushId;
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
        if (stratum > 1) {
            return true;
        }
        try {
            Coverage seen = coverage(principal, work, meta);
            int newBands = Math.max(0, through - Math.max(from, seen.get(p)));
            if (newBands == 0) {
                return true;
            }
            if (seen.fraction(stratum) >= capacity(role, stratum)
                    || !bucket(principal, work, stratum, role).take(newBands)) {
                return false;
            }
            seen.set(p, through);
            return true;
        } catch (IOException ex) {
            return false;
        }
    }

    private static double capacity(String role, int stratum) {
        if (role.equals(seurat.catalog.WorkRecord.PRIVILEGED)) {
            return stratum == 0 ? 0.30 : 1.0;
        }
        if (role.equals("autenticado")) {
            return stratum == 0 ? 0.15 : 1.0;
        }
        return stratum == 1 ? 0.25 : 0.0;
    }

    private TokenBucket bucket(String principal, String work, int stratum, String role) {
        long capacity;
        double rate;
        if (role.equals(seurat.catalog.WorkRecord.PRIVILEGED)) {
            capacity = 200000;
            rate = 100;
        } else if (role.equals(seurat.catalog.WorkRecord.AUTHENTICATED)) {
            capacity = stratum == 0 ? 20000 : 200000;
            rate = stratum == 0 ? 10 : 100;
        } else {
            capacity = 1000;
            rate = 1;
        }
        return buckets.computeIfAbsent(principal + "\0" + work + "\0" + stratum,
                k -> new TokenBucket(capacity, rate));
    }

    private Coverage coverage(String principal, String work, WorkMeta meta)
            throws IOException {
        String k = principal + "\0" + work;
        Coverage c = coverages.get(k);
        if (c == null) {
            Path dir = base.resolve(principal);
            Files.createDirectories(dir);
            c = new Coverage(dir.resolve(work + ".bits"), meta);
            coverages.put(k, c);
        }
        return c;
    }

}
