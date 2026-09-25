package seurat.session;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Predicate;
import seurat.proto.MsgGaze;
import seurat.proto.Ranges;
import seurat.store.BrushStore;
import seurat.store.WorkMeta;

/** Open work: handle, concession, authoritative book, pending orders. */
public final class Canvas {
    public record ScrapeOrder(long order, long through, long epoch,
            Predicate<Delivery> scrape, Ranges cancelled, long deadlineNs) {}

    private final long handle;
    private final String workId;
    private BrushStore store;
    private WorkMeta meta;
    private Concession concession;
    private final LoanBook book = new LoanBook();
    private Session session;
    private long nextOrder;
    private final Map<Long, ScrapeOrder> pendingOrders = new HashMap<>();
    private final Map<Long, Ranges> pendingRenewals = new HashMap<>();
    private MsgGaze.Gaze gaze;
    private long gazeSeq;
    private long planPrevistas;
    private long planHechas;

    public Canvas(long handle, String workId, BrushStore store, WorkMeta meta,
            Concession concession) {
        this.handle = handle;
        this.workId = workId;
        this.store = store;
        this.meta = meta;
        this.concession = concession;
    }

    public long handle() {
        return handle;
    }

    public String workId() {
        return workId;
    }

    public BrushStore store() {
        return store;
    }

    public void setStore(BrushStore store, WorkMeta meta) {
        this.store = store;
        this.meta = meta;
    }

    public Session session() {
        return session;
    }

    public void session(Session value) {
        session = value;
    }

    public long renewNs;
    public long auditNs;
    public long auditBase;
    /** Receiver window from this handle's last RECIBO.libre: max unconfirmed deliveries. */
    public volatile long free = seurat.config.SeuratConstants.INITIAL_CREDIT;

    public WorkMeta meta() {
        return meta;
    }

    public LoanBook book() {
        return book;
    }

    public Concession concession() {
        return concession;
    }

    public void setConcession(Concession c) {
        concession = c;
    }

    public long nextOrder() {
        return ++nextOrder;
    }

    public void addPendingOrder(ScrapeOrder order) {
        pendingOrders.put(order.order(), order);
    }

    public ScrapeOrder pendingOrder(long order) {
        return pendingOrders.get(order);
    }

    public java.util.List<ScrapeOrder> pendingOrders() {
        return java.util.List.copyOf(pendingOrders.values());
    }

    public void resolve(ScrapeOrder order) {
        pendingOrders.remove(order.order());
    }

    public void addPendingRenewal(long order, Ranges ranges) {
        pendingRenewals.put(order, ranges);
    }

    public void acknowledgeRenewal(long throughOrder, long nowNs, long leaseNs, long deltaNs) {
        var iter = pendingRenewals.entrySet().iterator();
        while (iter.hasNext()) {
            var e = iter.next();
            if (e.getKey() <= throughOrder) {
                book.acknowledge(e.getValue(), nowNs, leaseNs, deltaNs);
                iter.remove();
            }
        }
    }

    public MsgGaze.Gaze gaze() {
        return gaze;
    }

    public void setGaze(MsgGaze.Gaze value) {
        gaze = value;
        gazeSeq = value.seq();
    }

    public long gazeSeq() {
        return gazeSeq;
    }

    public void startPlan(long first, long expectedCount) {
        planPrevistas = expectedCount;
        planHechas = 0;
    }

    public boolean advancePlan() {
        return ++planHechas >= planPrevistas && planPrevistas > 0;
    }
}
