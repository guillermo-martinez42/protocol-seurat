package seurat.ingest;

/** 128x128 windows over a brush row, edge-replicated. Sweep order. */
final class Window {
    private Window() {}

    static int[][] parents(int[][] ps, int w2, int bx) {
        int[][] out = new int[3][16384];
        for (int c = 0; c < 3; c++) {
            for (int y = 0; y < 128; y++) {
                int srcY = y * w2;
                int dstY = y * 128;
                if ((bx + 1) * 128 <= w2) {
                    System.arraycopy(ps[c], srcY + bx * 128, out[c], dstY, 128);
                } else {
                    for (int x = 0; x < 128; x++) {
                        out[c][dstY + x] = ps[c][srcY + Math.min(bx * 128 + x, w2 - 1)];
                    }
                }
            }
        }
        return out;
    }

    static int[][][] details(int[][] det, int w2, int bx) {
        int[][][] out = new int[det.length][1][16384];
        for (int c = 0; c < det.length; c++) {
            int[] dst = out[c][0];
            int[] src = det[c];
            for (int y = 0; y < 128; y++) {
                int srcY = y * w2;
                int dstY = y * 128;
                if ((bx + 1) * 128 <= w2) {
                    System.arraycopy(src, srcY + bx * 128, dst, dstY, 128);
                } else {
                    for (int x = 0; x < 128; x++) {
                        dst[dstY + x] = src[srcY + Math.min(bx * 128 + x, w2 - 1)];
                    }
                }
            }
        }
        return out;
    }

    static int[][][] details(int[][][] det, int w2, int bx) {
        int[][][] out = new int[det.length][1][16384];
        for (int c = 0; c < det.length; c++) {
            int[] dst = out[c][0];
            int[] src = det[c][0];
            for (int y = 0; y < 128; y++) {
                int srcY = y * w2;
                int dstY = y * 128;
                if ((bx + 1) * 128 <= w2) {
                    System.arraycopy(src, srcY + bx * 128, dst, dstY, 128);
                } else {
                    for (int x = 0; x < 128; x++) {
                        dst[dstY + x] = src[srcY + Math.min(bx * 128 + x, w2 - 1)];
                    }
                }
            }
        }
        return out;
    }
}
