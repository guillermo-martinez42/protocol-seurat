package seurat.codec;

/** Dead-zone quantization + per-stratum q table. qC=0 means no chroma refine. */
public final class Quant {
    private Quant() {}

    public static int quantize(int x, int q) {
        if (q <= 0) {
            return 0;
        }
        int a = Math.abs(x);
        int i = a / q;
        return x < 0 ? -i : i;
    }

    public static int dequantize(int i, int q) {
        if (i == 0 || q <= 0) {
            return 0;
        }
        int m = Math.abs(i) * q + q / 2;
        return i < 0 ? -m : m;
    }

    public static int qy(int stratum) {
        if (stratum <= 0) {
            return 6;
        }
        if (stratum == 1) {
            return 4;
        }
        if (stratum == 2) {
            return 2;
        }
        return 1;
    }

    public static int qc(int stratum) {
        if (stratum <= 0) {
            return 0;
        }
        if (stratum == 1) {
            return 6;
        }
        if (stratum == 2) {
            return 3;
        }
        return 2;
    }
}
