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

<<<<<<< HEAD:src/main/java/seurat/codec/Bands.java
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
=======
    private static final ThreadLocal<Deflater> DEFLATERS =
            ThreadLocal.withInitial(() -> new Deflater(seurat.config.SeuratConstants.DEFLATE_LEVEL, true));
    private static final ThreadLocal<byte[]> RAW_BUFS =
            ThreadLocal.withInitial(() -> new byte[512 * 1024]);
    private static final ThreadLocal<byte[]> COMP_BUFS =
            ThreadLocal.withInitial(() -> new byte[512 * 1024]);

    /** Order of parents: E desc, morton asc. Returns rank per parent index. */
    public static int[] order(int[] energy, int n) {
        return BandsOrder.order(energy, n);
>>>>>>> 9c712d8c97a04d5304e6153c9e590526f79ec381:server/src/seurat/codec/Bands.java
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
        byte[] raw = RAW_BUFS.get();
        int pos = 0;
        for (int i = 0; i < n; i += 8) {
            int by = 0;
            for (int k = 0; k < 8 && i + k < n; k++) {
                if (members[i + k] != 0) {
                    by |= 1 << k;
                }
            }
            raw[pos++] = (byte) by;
        }
        for (int[][] ch : vals) {
            for (int[] det : ch) {
                for (int i = 0; i < n; i++) {
                    if (members[i] != 0) {
                        int v = (det[i] << 1) ^ (det[i] >> 31);
                        while ((v & ~0x7F) != 0) {
                            raw[pos++] = (byte) ((v & 0x7F) | 0x80);
                            v >>>= 7;
                        }
                        raw[pos++] = (byte) v;
                    }
                }
            }
        }
<<<<<<< HEAD:src/main/java/seurat/codec/Bands.java
        byte[] raw = Arrays.copyOf(b.array(), b.position());
        // zlib default (6): ingest 1.7x faster than level 9 for 0.8% more bytes (1 GB sample).
        Deflater d = new Deflater(Deflater.DEFAULT_COMPRESSION, true);
        d.setInput(raw);
=======
        Deflater d = DEFLATERS.get();
        d.reset();
        d.setInput(raw, 0, pos);
>>>>>>> 9c712d8c97a04d5304e6153c9e590526f79ec381:server/src/seurat/codec/Bands.java
        d.finish();
        byte[] comp = COMP_BUFS.get();
        int len = d.deflate(comp);
        if (d.finished()) {
            return Arrays.copyOf(comp, len);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(pos);
        out.write(comp, 0, len);
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
