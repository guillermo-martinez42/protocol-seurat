package seurat.codec;

import java.util.Arrays;

/**
 * Energy ordering with Morton tie-breaker.
 * Uses primitive long packing and dual-pivot quicksort for zero object allocation.
 */
public final class BandsOrder {
    private BandsOrder() {}

    private static final int N_16K = 16384;
    private static final int[] MORTON_16K = new int[N_16K];

    static {
        for (int i = 0; i < N_16K; i++) {
            MORTON_16K[i] = (int) Morton.encode(i % 128, i / 128);
        }
    }

    public static int[] order(int[] energy, int n) {
        long[] packed = new long[n];
        boolean is16k = (n == N_16K);
        int side = is16k ? 128 : (int) Math.sqrt(n);
        for (int i = 0; i < n; i++) {
            int morton = is16k ? MORTON_16K[i] : (int) Morton.encode(i % side, i / side);
            // ~E is descending for every int; an offset key sets bit 63 for E < 0 and sorts it first.
            packed[i] = ((long) ~energy[i] << 32) | ((long) (morton & 0xFFFF) << 16) | (i & 0xFFFF);
        }
        Arrays.sort(packed);
        int[] rank = new int[n];
        for (int r = 0; r < n; r++) {
            int originalIdx = (int) (packed[r] & 0xFFFF);
            rank[originalIdx] = r;
        }
        return rank;
    }
}
