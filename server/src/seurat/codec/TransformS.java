package seurat.codec;

/** Integer Haar lifting (S) per 2x2 [a b; c d]. Exact round-trip. */
public final class TransformS {
    private TransformS() {}

    /** Forward: returns {S, V, H, D}. */
    public static int[] forward(int a, int b, int c, int d) {
        int l1 = (a + b) >> 1;
        int h1 = a - b;
        int l2 = (c + d) >> 1;
        int h2 = c - d;
        return new int[]{(l1 + l2) >> 1, l1 - l2, (h1 + h2) >> 1, h1 - h2};
    }

    /** Inverse of {S, V, H, D} back to {a, b, c, d}. */
    public static int[] inverse(int stratum, int v, int h, int dd) {
        int l1 = stratum + ((v + 1) >> 1);
        int l2 = l1 - v;
        int h1 = h + ((dd + 1) >> 1);
        int h2 = h1 - dd;
        int a = l1 + ((h1 + 1) >> 1);
        return new int[]{a, a - h1, l2 + ((h2 + 1) >> 1), l2 + ((h2 + 1) >> 1) - h2};
    }

    /** Block forward on even-sized plane: S/H/V/D quarter-planes out. */
    public static void blockForward(int[] src, int w, int h,
            int[] ps, int[] pv, int[] ph, int[] pd) {
        int hw = w / 2;
        for (int y = 0; y < h; y += 2) {
            for (int x = 0; x < w; x += 2) {
                int[] v = forward(src[y * w + x], src[y * w + x + 1],
                        src[(y + 1) * w + x], src[(y + 1) * w + x + 1]);
                int o = (y / 2) * hw + x / 2;
                ps[o] = v[0];
                pv[o] = v[1];
                ph[o] = v[2];
                pd[o] = v[3];
            }
        }
    }

    /** Block inverse: quarters back into the plane. */
    public static void blockInverse(int[] ps, int[] pv, int[] ph, int[] pd,
            int hw, int hh, int[] dst) {
        int w = hw * 2;
        for (int y = 0; y < hh; y++) {
            for (int x = 0; x < hw; x++) {
                int o = y * hw + x;
                int[] v = inverse(ps[o], pv[o], ph[o], pd[o]);
                dst[(2 * y) * w + 2 * x] = v[0];
                dst[(2 * y) * w + 2 * x + 1] = v[1];
                dst[(2 * y + 1) * w + 2 * x] = v[2];
                dst[(2 * y + 1) * w + 2 * x + 1] = v[3];
            }
        }
    }
}
