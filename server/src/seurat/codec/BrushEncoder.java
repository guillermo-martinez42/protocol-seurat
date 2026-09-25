package seurat.codec;

import java.util.Arrays;

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
        BrushWorkspace ws = BrushWorkspace.LOCAL.get();
        int nch = qc > 0 ? 3 : 1;
        int[][][] q = ws.q;
        int[] energy = ws.energy;
        Arrays.fill(energy, 0);

        for (int c = 0; c < nch; c++) {
            int qq = c == 0 ? qy : qc;
            int w = c == 0 ? 2 : 1;
            int[] p = parents[c];
            int[] hc = h[c][0];
            int[] vc = v[c][0];
            int[] dc = d[c][0];
            int[] q0 = q[c][0];
            int[] q1 = q[c][1];
            int[] q2 = q[c][2];

            int i = 0;
            for (int y = 0; y < side; y++) {
                int yPrev = y == 0 ? 0 : -side;
                int yNext = y == side - 1 ? 0 : side;
                for (int x = 0; x < side; x++, i++) {
                    int xPrev = x == 0 ? 0 : -1;
                    int xNext = x == side - 1 ? 0 : 1;
                    int hHat = (p[i + xPrev] - p[i + xNext] + 2) >> 2;
                    int vHat = (p[i + yPrev] - p[i + yNext] + 2) >> 2;
                    int qh = (hc[i] - hHat) / qq;
                    int qv = (vc[i] - vHat) / qq;
                    int qd = dc[i] / qq;
                    q0[i] = qh;
                    q1[i] = qv;
                    q2[i] = qd;
                    energy[i] += w * (Math.abs(qh) + Math.abs(qv) + Math.abs(qd));
                }
            }
        }

        long[] packed = ws.sortPacked;
        int[] mortonTab = BrushWorkspace.MORTON_16K;
        for (int i = 0; i < n; i++) {
            long high = 0xFFFFFFFFL - (((long) energy[i]) - (long) Integer.MIN_VALUE);
            long mid = (long) (mortonTab[i] & 0xFFFF);
            packed[i] = (high << 32) | (mid << 16) | (long) i;
        }
        Arrays.sort(packed);
        int[] rank = ws.rank;
        for (int r = 0; r < n; r++) {
            int origIdx = (int) (packed[r] & 0xFFFF);
            rank[origIdx] = r;
        }

        byte[][] bands = new byte[4][];
        long[] crcs = new long[4];
        byte[] raw = ws.rawBuf;
        byte[] comp = ws.compBuf;
        var deflater = ws.deflater;
        var crc = ws.crc;

        for (int b = 0; b < 4; b++) {
            int low = Bands.CUTS[b];
            int high = Bands.CUTS[b + 1];
            int rawPos = 0;

            for (int i = 0; i < n; i += 8) {
                int by = 0;
                for (int k = 0; k < 8; k++) {
                    int rk = rank[i + k];
                    if (rk >= low && rk < high) {
                        by |= 1 << k;
                    }
                }
                raw[rawPos++] = (byte) by;
            }

            for (int c = 0; c < nch; c++) {
                for (int dd = 0; dd < 3; dd++) {
                    int[] det = q[c][dd];
                    for (int i = 0; i < n; i++) {
                        int rk = rank[i];
                        if (rk >= low && rk < high) {
                            int val = det[i];
                            int zz = (val << 1) ^ (val >> 31);
                            while ((zz & ~0x7F) != 0) {
                                raw[rawPos++] = (byte) ((zz & 0x7F) | 0x80);
                                zz >>>= 7;
                            }
                            raw[rawPos++] = (byte) zz;
                        }
                    }
                }
            }

            deflater.reset();
            deflater.setInput(raw, 0, rawPos);
            deflater.finish();
            int compLen = deflater.deflate(comp);
            byte[] bandBytes = Arrays.copyOf(comp, compLen);
            bands[b] = bandBytes;

            crc.reset();
            crc.update(bandBytes);
            crcs[b] = crc.getValue();
        }

        return new BrushBands(bands, crcs);
    }
}
