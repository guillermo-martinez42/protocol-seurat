package seurat.codec;

/** YCoCg-R exact reversible color. Y in [0,255], Co/Cg in [-255,255]. */
public final class YCoCgR {
    private YCoCgR() {}

    public static int[] forward(int r, int g, int b) {
        int co = r - b;
        int t = b + (co >> 1);
        int cg = g - t;
        return new int[]{t + (cg >> 1), co, cg};
    }

    public static int[] inverse(int y, int co, int cg) {
        int t = y - (cg >> 1);
        int g = cg + t;
        int b = t - (co >> 1);
        return new int[]{b + co, g, b};
    }

    /** Row of packed RGB to planar Y/Co/Cg. */
    public static void forwardRow(int[] rgb, int off, int[] y, int[] co, int[] cg,
            int dst, int n) {
        for (int i = 0; i < n; i++) {
            int p = rgb[off + i];
            int[] v = forward((p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF);
            y[dst + i] = v[0];
            co[dst + i] = v[1];
            cg[dst + i] = v[2];
        }
    }
}
