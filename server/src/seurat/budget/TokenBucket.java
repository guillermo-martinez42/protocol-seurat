package seurat.budget;

/** Token bucket: capacity bands, refill per second. */
final class TokenBucket {
    private final long capacity;
    private final double rate;
    private double balance;
    private long updatedNs;

    TokenBucket(long capacity, double rate) {
        this.capacity = capacity;
        this.rate = rate;
        this.balance = capacity;
        this.updatedNs = System.nanoTime();
    }

    synchronized boolean take(long n) {
        long now = System.nanoTime();
        balance = Math.min(capacity, balance + (now - updatedNs) / 1e9 * rate);
        updatedNs = now;
        if (balance < n) {
            return false;
        }
        balance -= n;
        return true;
    }
}
