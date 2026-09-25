package seurat.session;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import seurat.codec.BrushId;
import seurat.config.SeuratConstants;
import seurat.proto.Ranges;

/**
 * Authoritative loan model for one canvas. Touched by its Easel and the
 * Painter under the canvas lock. Survives L+delta past disconnect (resume).
 */
public final class LoanBook {
    private final TreeMap<Long, Delivery> deliveries = new TreeMap<>();
    private final Map<BrushId, TreeMap<Integer, Delivery>> byBrush = new HashMap<>();
    private final Map<Long, Long> deadlineNs = new HashMap<>();
    private final Set<Long> settled = new HashSet<>();
    private long last;

    public synchronized long lastNumber() {
        return last;
    }

    public synchronized int size() {
        return deliveries.size();
    }

    /** Highest band held for a brush; seed counts complete only if present. */
    public synchronized int bands(BrushId p) {
        TreeMap<Integer, Delivery> group = byBrush.get(p);
        if (group == null) {
            return 0;
        }
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            return 4;
        }
        return group.lastEntry().getValue().through();
    }

    /** Numbers BEFORE opening the flow. */
    public synchronized Delivery log(BrushId p, int from, int through, int bytes,
            long epoch) {
        Delivery e = new Delivery(++last, p, from, through, bytes, epoch);
        deliveries.put(e.number(), e);
        byBrush.computeIfAbsent(p, k -> new TreeMap<>()).put(from, e);
        return e;
    }

    public synchronized void acknowledge(Ranges r, long ahoraNs, long arriendoNs, long deltaNs) {
        r.forEach(n -> deadlineNs.put(n, ahoraNs + arriendoNs + deltaNs));
    }

    /** Client confirmed synthesis via RECIBO: safe to audit through it. */
    public synchronized void settle(Ranges r) {
        r.forEach(settled::add);
    }

    /**
     * Highest N such that every book entry ≤ N is client-confirmed (RECIBO).
     * Unsettled (in-flight or unsynthesized) deliveries block the watermark,
     * so an audit never counts a number the client may not hold yet.
     */
    public synchronized long settledThrough() {
        for (long n : deliveries.keySet()) {
            if (!settled.contains(n)) {
                return n - 1;
            }
        }
        return last;
    }

    public synchronized void release(Ranges r) {
        r.forEach(this::remove);
    }

    public synchronized void cancel(long n) {
        remove(n);
    }

    public synchronized boolean contains(long n) {
        return deliveries.containsKey(n);
    }

    public synchronized Ranges pruneExpired(long nowNs) {
        Ranges.Builder expired = new Ranges.Builder();
        for (var entry : new HashMap<>(deadlineNs).entrySet()) {
            if (entry.getValue() < nowNs) {
                expired.add(entry.getKey());
                remove(entry.getKey());
            }
        }
        return expired.build();
    }

    /** Book ∩ [1,through] minus predicate minus cancelled: what client must keep. */
    public synchronized Ranges expected(long through,
            java.util.function.Predicate<Delivery> scrape, Ranges cancelled) {
        Ranges.Builder c = new Ranges.Builder();
        for (Delivery e : deliveries.headMap(through, true).values()) {
            if (!scrape.test(e) && !cancelled.contains(e.number())) {
                c.add(e.number());
            }
        }
        return c.build();
    }

    public synchronized void retainOnly(long through, Ranges conservar) {
        for (long n : deliveries.headMap(through, true).keySet().stream().toList()) {
            if (!conservar.contains(n)) {
                remove(n);
            }
        }
    }

    public synchronized Ranges numbersThrough(long through) {
        Ranges.Builder c = new Ranges.Builder();
        for (long n : deliveries.headMap(through, true).keySet()) {
            c.add(n);
        }
        return c.build();
    }

    private void remove(long n) {
        Delivery e = deliveries.remove(n);
        if (e == null) {
            return;
        }
        deadlineNs.remove(n);
        settled.remove(n);
        TreeMap<Integer, Delivery> group = byBrush.get(e.brush());
        if (group != null) {
            group.remove(e.from());
            if (group.isEmpty()) {
                byBrush.remove(e.brush());
            }
        }
    }
}
