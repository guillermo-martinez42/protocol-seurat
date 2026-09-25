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

    private static final ThreadLocal<Deflater> DEFLATERS =
            ThreadLocal.withInitial(() -> new Deflater(seurat.config.SeuratConstants.DEFLATE_LEVEL, true));

    /** Order of parents: E desc, morton asc. Returns rank per parent index. */
    public static int[] order(int[] energy, int n) {
        return BandsOrder.order(energy, n);
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
        Deflater d = DEFLATERS.get();
        d.reset();
        d.setInput(b.array(), 0, b.position());
        d.finish();
        ByteArrayOutputStream out = new ByteArrayOutputStream(b.position());
        byte[] tmp = new byte[8192];
        while (!d.finished()) {
            out.write(tmp, 0, d.deflate(tmp));
        }
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
