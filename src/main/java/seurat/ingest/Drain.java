package seurat.ingest;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import seurat.codec.BrushEncoder;
import seurat.codec.Quant;
import seurat.codec.TransformS;
import seurat.store.FileBrushStore;

/** One stratum drain: 256 E(stratum) rows -> brush-row encode + 128 rows upward. */
final class Drain {
    private final int stratum;
    private final int top;
    private final Accumulator[] acc;
    private final FileBrushStore store;
    private final ExecutorService pool;
    private final List<Future<?>> tasks;
    private final List<short[][]> seed;
    private final int[] drainCounts;

    Drain(int stratum, int top, Accumulator[] acc, FileBrushStore store,
            ExecutorService pool, List<Future<?>> tasks, List<short[][]> seed,
            int[] drainCounts) {
        this.stratum = stratum;
        this.top = top;
        this.acc = acc;
        this.store = store;
        this.pool = pool;
        this.tasks = tasks;
        this.seed = seed;
        this.drainCounts = drainCounts;
    }

    void drain() {
        Accumulator a = acc[stratum];
        int w2 = a.width / 2;
        int[][] ps = new int[3][128 * w2];
        int[][][] hd = new int[3][1][128 * w2];
        int[][][] vd = new int[3][1][128 * w2];
        int[][][] dd = new int[3][1][128 * w2];
        for (int c = 0; c < 3; c++) {
            int[] src = new int[256 * a.width];
            for (int y = 0; y < 256; y++) {
                for (int x = 0; x < a.width; x++) {
                    src[y * a.width + x] = a.plane[c][y][x];
                }
            }
            int[] h = new int[128 * w2];
            int[] v = new int[128 * w2];
            int[] d = new int[128 * w2];
            TransformS.blockForward(src, a.width, 256, ps[c], v, h, d);
            hd[c][0] = h;
            vd[c][0] = v;
            dd[c][0] = d;
        }
        int nx = (a.width + 255) / 256;
        int by = drainCounts[stratum]++;
        int qy = Quant.qy(stratum);
        int qc = Quant.qc(stratum);
        final int level = stratum;
        final int row = by;
        for (int bx = 0; bx < nx; bx++) {
            final int col = bx;
            int[][] pw = Window.parents(ps, w2, col);
            int[][][] hw = Window.details(hd, w2, col);
            int[][][] vw = Window.details(vd, w2, col);
            int[][][] dw = Window.details(dd, w2, col);
            tasks.add(pool.submit(() -> {
                var bb = BrushEncoder.encode(pw, hw, vw, dw, 16384, 128, qy, qc);
                store.append(level, col, row, bb.bands(), bb.crcs());
                return null;
            }));
        }
        a.clear();
        pushUp(ps, w2);
    }

    private void pushUp(int[][] ps, int w2) {
        if (stratum + 1 >= top) {
            for (int y = 0; y < 128; y++) {
                short[][] f = new short[3][w2];
                for (int c = 0; c < 3; c++) {
                    for (int x = 0; x < w2; x++) {
                        f[c][x] = (short) ps[c][y * w2 + x];
                    }
                }
                seed.add(f);
            }
            return;
        }
        Accumulator up = acc[stratum + 1];
        for (int y = 0; y < 128; y++) {
            if (up.full()) {
                new Drain(stratum + 1, top, acc, store, pool, tasks, seed, drainCounts).drain();
            }
            int[] yy = new int[w2];
            int[] co = new int[w2];
            int[] cg = new int[w2];
            for (int x = 0; x < w2; x++) {
                yy[x] = ps[0][y * w2 + x];
                co[x] = ps[1][y * w2 + x];
                cg[x] = ps[2][y * w2 + x];
            }
            up.addRow(up.rows, yy, co, cg, w2);
        }
    }
}
