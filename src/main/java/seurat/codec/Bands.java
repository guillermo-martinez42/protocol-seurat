package seurat.codec;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.zip.DataFormatException;
import java.util.zip.Deflater;
import java.util.zip.Inflater;
import seurat.proto.Leb128;

/**
 * Significance bands: energy sort, membership bitmap, planar zigzag+LEB128,
 * whole payload deflate-raw. Unpack mirrors pack exactly.
 */
public final class Bands {
    private Bands() {}

    public static final int PARENTS = 16384;
    public static final int[] CUTS = {0, 2048, 4096, 8192, 16384};

    /**
     * Order of parents: E desc, morton asc. Returns rank per parent index.
     * One primitive sort on packed keys: ~E (high 32) | morton << 14 | index.
     */
    public static int[] order(int[] energy, int n) {
        if (n > PARENTS) {
            throw new IllegalArgumentException("n > " + PARENTS);
        }
        int side = (int) Math.sqrt(n);
        long[] keys = new long[n];
        for (int i = 0; i < n; i++) {
            long m = Morton.encode(i % side, i / side);
            keys[i] = ((long) ~energy[i] << 32) | (m << 14) | i;
        }
        Arrays.sort(keys);
        int[] rank = new int[n];
        for (int r = 0; r < n; r++) {
            rank[(int) (keys[r] & 0x3FFF)] = r;
        }
        return rank;
    }

    public static int bandOf(int rank) {
        if (rank < CUTS[1]) {
            return 0;
        }
        if (rank < CUTS[2]) {
            return 1;
        }
        if (rank < CUTS[3]) {
            return 2;
        }
        return 3;
    }

    /** Packs one band. vals[channel][detail][sweepPos] sparse via members bitmap. */
    public static byte[] pack(int[] members, int[][][] vals) {
        int n = members.length;
        ByteBuffer b = ByteBuffer.allocate(8 + n / 8 + vals.length * vals[0].length * n * 3);
        for (int i = 0; i < n; i += 8) {
            int by = 0;
            for (int k = 0; k < 8 && i + k < n; k++) {
                if (members[i + k] != 0) {
                    by |= 1 << k;
                }
            }
            b.put((byte) by);
        }
        for (int[][] ch : vals) {
            for (int[] det : ch) {
                for (int i = 0; i < n; i++) {
                    if (members[i] != 0) {
                        Leb128.putU(b, Leb128.zigzagEncode(det[i]));
                    }
                }
            }
        }
        byte[] raw = Arrays.copyOf(b.array(), b.position());
        // zlib default (6): ingest 1.7x faster than level 9 for 0.8% more bytes (1 GB sample).
        Deflater d = new Deflater(Deflater.DEFAULT_COMPRESSION, true);
        d.setInput(raw);
        d.finish();
        ByteArrayOutputStream out = new ByteArrayOutputStream(raw.length);
        byte[] tmp = new byte[8192];
        while (!d.finished()) {
            out.write(tmp, 0, d.deflate(tmp));
        }
        d.end();
        return out.toByteArray();
    }

    /** Unpacks into vals (zero-filled first by caller). Returns members bitmap. */
    public static int[] unpack(byte[] band, int n, int[][][] vals) {
        Inflater inf = new Inflater(true);
        inf.setInput(band);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] tmp = new byte[8192];
        try {
            while (!inf.finished()) {
                int k = inf.inflate(tmp);
                if (k == 0) {
                    break;
                }
                out.write(tmp, 0, k);
            }
        } catch (DataFormatException ex) {
            throw new IllegalArgumentException("corrupt deflate-raw", ex);
        } finally {
            inf.end();
        }
        ByteBuffer b = ByteBuffer.wrap(out.toByteArray());
        int[] members = new int[n];
        for (int i = 0; i < n; i += 8) {
            int by = Byte.toUnsignedInt(b.get());
            for (int k = 0; k < 8 && i + k < n; k++) {
                members[i + k] = (by >> k) & 1;
            }
        }
        for (int[][] ch : vals) {
            for (int[] det : ch) {
                for (int i = 0; i < n; i++) {
                    if (members[i] != 0) {
                        det[i] = Leb128.zigzagDecode(Leb128.getU(b));
                    }
                }
            }
        }
        return members;
    }
}
