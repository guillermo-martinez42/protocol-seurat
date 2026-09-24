package seurat.store;

import java.nio.ByteBuffer;

/** One 40B index record: offset + 4 cumulative band ends + 4 CRC-32C. */
public record IndexEntry(long offset, long[] ends, long[] crcs) {
    public static final int BYTES = 40;
    public static final long AUSENTE = 0xFFFF_FFFF_FFFF_FFFFL;

    public static IndexEntry missing() {
        return new IndexEntry(AUSENTE, new long[4], new long[4]);
    }

    public boolean isMissing() {
        return offset == AUSENTE;
    }

    public boolean isEmpty() {
        if (isMissing()) {
            return false;
        }
        for (long f : ends) {
            if (f != 0) {
                return false;
            }
        }
        return true;
    }

    public byte[] encode() {
        ByteBuffer b = ByteBuffer.allocate(BYTES);
        b.putLong(offset);
        for (long f : ends) {
            b.putInt((int) f);
        }
        for (long c : crcs) {
            b.putInt((int) c);
        }
        return b.array();
    }

    public static IndexEntry decode(ByteBuffer b) {
        long off = b.getLong();
        long[] f = new long[4];
        long[] c = new long[4];
        for (int i = 0; i < 4; i++) {
            f[i] = Integer.toUnsignedLong(b.getInt());
        }
        for (int i = 0; i < 4; i++) {
            c[i] = Integer.toUnsignedLong(b.getInt());
        }
        return new IndexEntry(off, f, c);
    }
}
