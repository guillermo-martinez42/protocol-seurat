package seurat.codec;

import java.util.zip.CRC32C;

/**
 * One brush, 128x128 parents: S+P predict, quantize, energy order, band pack.
 * Input planes are row-major sweep order, n = 16384.
 */
public final class BrushEncoder {
    private BrushEncoder() {}

    public record BrushBands(byte[][] bands, long[] crcs) {}

    /** chan 0=Y always; 1=Co,2=Cg only if qc>0. det[d][c][i]. */
    public static BrushBands encode(int[][] parents, int[][][] h, int[][][] v,
            int[][][] d, int n, int side, int qy, int qc) {
        int nch = qc > 0 ? 3 : 1;
        int[][][] q = new int[3][3][n];
        int[] energy = new int[n];
        for (int c = 0; c < nch; c++) {
            int qq = c == 0 ? qy : qc;
            for (int i = 0; i < n; i++) {
                int x = i % side;
                int y = i / side;
                int rh = h[c][0][i] - PredictSP.hHat(parents[c], side, side, x, y);
                int rv = v[c][0][i] - PredictSP.vHat(parents[c], side, side, x, y);
                q[c][0][i] = Quant.quantize(rh, qq);
                q[c][1][i] = Quant.quantize(rv, qq);
                q[c][2][i] = Quant.quantize(d[c][0][i], qq);
                int w = c == 0 ? 2 : 1;
                energy[i] += w * (Math.abs(q[c][0][i]) + Math.abs(q[c][1][i]) + Math.abs(q[c][2][i]));
            }
        }
        int[] rank = Bands.order(energy, n);
        byte[][] bands = new byte[4][];
        long[] crcs = new long[4];
        for (int b = 0; b < 4; b++) {
            int[] members = new int[n];
            for (int i = 0; i < n; i++) {
                members[i] = Bands.bandOf(rank[i]) == b ? 1 : 0;
            }
            int[][][] vals = new int[nch][3][n];
            for (int c = 0; c < nch; c++) {
                for (int dd = 0; dd < 3; dd++) {
                    System.arraycopy(q[c][dd], 0, vals[c][dd], 0, n);
                }
            }
            bands[b] = Bands.pack(members, vals);
            CRC32C crc = new CRC32C();
            crc.update(bands[b]);
            crcs[b] = crc.getValue();
        }
        return new BrushBands(bands, crcs);
    }
}
