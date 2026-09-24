package seurat.session;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicLong;
import seurat.config.SeuratConstants;
import seurat.net.Mapping;

/** Per-connection state. Only its Easel writes it. */
public final class Session {

    private final long id;
    private final String principal;
    private final String role;
    private final long memMib;
    private final long caps;
    private final Mapping mapping;
    private final Map<Long, Canvas> canvases = new ConcurrentHashMap<>();
    private final Semaphore slots = new Semaphore(SeuratConstants.MAX_IN_FLIGHT);
    private final AtomicLong nextHandle = new AtomicLong();
    public volatile byte[] ticket;
    public volatile double alpha;
    public volatile double share = 1.0;
    public volatile long tickDeliveries;
    public volatile long tickMarked;
    public volatile long stride;
    public volatile long lastActivityNs = System.nanoTime();
    public volatile long lastGazeNs;
    public volatile long free = 768;
    public volatile long queueMs;
    public volatile long heartbeatNs;
    private final java.util.concurrent.atomic.AtomicInteger inFlight = new java.util.concurrent.atomic.AtomicInteger();
    private double bucket = SeuratConstants.GAZE_BURST;

    public Session(long id, String principal, String role, long memMib, long caps,
            Mapping mapping, byte[] ticket) {
        this.id = id;
        this.principal = principal;
        this.role = role;
        this.memMib = memMib;
        this.caps = caps;
        this.mapping = mapping;
        this.ticket = ticket;
    }

    public long id() {
        return id;
    }

    public String principal() {
        return principal;
    }

    public String role() {
        return role;
    }

    public long memMib() {
        return memMib;
    }

    public long caps() {
        return caps;
    }

    public Mapping mapping() {
        return mapping;
    }

    public byte[] ticket() {
        return ticket;
    }

    public void ticket(byte[] value) {
        ticket = value;
    }

    public Map<Long, Canvas> canvases() {
        return canvases;
    }

    public long newHandle() {
        return nextHandle.incrementAndGet();
    }

    public boolean takeSlot() {
        if (!slots.tryAcquire()) {
            return false;
        }
        inFlight.incrementAndGet();
        return true;
    }

    public void releaseSlot() {
        inFlight.decrementAndGet();
        slots.release();
    }

    public int inFlight() {
        return inFlight.get();
    }

    /** 20/stratum bucket, burst 40; excess coalesces (last MIRADA wins). */
    public synchronized boolean takeGaze() {
        long now = System.nanoTime();
        double dt = (now - lastGazeNs) / 1e9;
        lastGazeNs = now;
        bucket = Math.min(SeuratConstants.GAZE_BURST, bucket + dt * SeuratConstants.GAZE_PER_S);
        if (bucket >= 1) {
            bucket -= 1;
            return true;
        }
        return false;
    }
}
