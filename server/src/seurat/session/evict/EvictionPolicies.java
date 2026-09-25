package seurat.session.evict;

import java.util.HashMap;
import java.util.Map;
import java.util.ServiceLoader;

/**
 * Registry + factory. New algorithms plug in without touching callers:
 * either register here or expose via {@link ServiceLoader}.
 */
public final class EvictionPolicies {
    private static final Map<String, EvictionPolicy> BUILTINS = new HashMap<>();

    static {
        LruEvictionPolicy lru = new LruEvictionPolicy();
        BUILTINS.put(lru.name(), lru);
        for (EvictionPolicy p : ServiceLoader.load(EvictionPolicy.class)) {
            BUILTINS.putIfAbsent(p.name(), p);
        }
    }

    private EvictionPolicies() {}

    public static EvictionPolicy fromName(String name) {
        EvictionPolicy found = BUILTINS.get(name);
        if (found == null) {
            throw new IllegalArgumentException("unknown eviction policy: " + name);
        }
        return found;
    }

    public static void register(EvictionPolicy policy) {
        BUILTINS.put(policy.name(), policy);
    }
}
