package seurat.ingest;

/** 128x128 windows over a brush row, edge-replicated. Sweep order. */
final class Window {
    private Window() {}

    static int[][] parents(int[][] ps, int w2, int bx) {
        int[][] out = new int[3][16384];
        for (int c = 0; c < 3; c++) {
            for (int y = 0; y < 128; y++) {
                for (int x = 0; x < 128; x++) {
                    out[c][y * 128 + x] = ps[c][y * w2 + Math.min(bx * 128 + x, w2 - 1)];
                }
            }
        }
        return out;
    }

    static int[][][] details(int[][][] det, int w2, int bx) {
        int[][][] out = new int[det.length][1][16384];
        for (int c = 0; c < det.length; c++) {
            for (int y = 0; y < 128; y++) {
                for (int x = 0; x < 128; x++) {
                    out[c][0][y * 128 + x] = det[c][0][y * w2 + Math.min(bx * 128 + x, w2 - 1)];
                }
            }
        }
        return out;
    }
}
