package seurat.codec;

/**
 * Dead-zone quantization + per-stratum q table. qC=0 means no chroma refine.
 * Table 1 (stores without a "quant" marker): lossy s0-s2, 4:2:0 at s0, ~31 dB on pixel text.
 * Table 2: s1+ lossless, s0 q 2 with full chroma: every pixel within 4 levels of the master
 * (~52 dB), so zoomed-in pixels are exact to the eye while the master bytes never leave.
 */
public final class Quant {
    /** Table new stores are encoded with; IngestJob writes it beside the store. */
    public static final int TABLE = 2;

    private Quant() {}

    public static int quantize(int x, int q) {
        return q <= 0 ? 0 : x / q;
    }

    public static int dequantize(int i, int q) {
        if (i == 0 || q <= 0) {
            return 0;
        }
        int m = Math.abs(i) * q + q / 2;
        return i < 0 ? -m : m;
    }

    public static int qy(int stratum) {
        return qy(TABLE, stratum);
    }

    public static int qc(int stratum) {
        return qc(TABLE, stratum);
    }

    public static int qy(int table, int stratum) {
        if (table >= 2) {
            return stratum <= 0 ? 2 : 1;
        }
        return stratum <= 0 ? 6 : stratum == 1 ? 4 : stratum == 2 ? 2 : 1;
    }

    public static int qc(int table, int stratum) {
        if (table >= 2) {
            return stratum <= 0 ? 2 : 1;
        }
        return stratum <= 0 ? 0 : stratum == 1 ? 6 : stratum == 2 ? 3 : 2;
    }
}
