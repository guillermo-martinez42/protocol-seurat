package seurat.ingest;

/** 256-row int16 accumulator for one stratum. Not thread-safe. */
final class Accumulator {
    final short[][][] plane = new short[3][][];
    final int width;
    int rows;

    Accumulator(int width) {
        this.width = width;
        for (int c = 0; c < 3; c++) {
            plane[c] = new short[256][width];
        }
    }

    void addRow(int y, int[] yy, int[] co, int[] cg, int w) {
        for (int x = 0; x < width; x++) {
            int sx = Math.min(x, w - 1);
            plane[0][y][x] = (short) yy[sx];
            plane[1][y][x] = (short) co[sx];
            plane[2][y][x] = (short) cg[sx];
        }
        rows = Math.max(rows, y + 1);
    }

    boolean full() {
        return rows >= 256;
    }

    void clear() {
        rows = 0;
    }
}
