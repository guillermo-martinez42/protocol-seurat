package seurat.proto;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Little helpers over big-endian buffers. Single place for u8/u32/u64/str. */
public final class Buf {
    private Buf() {}

    public static void u8(ByteBuffer b, int v) {
        b.put((byte) v);
    }

    public static void u32(ByteBuffer b, long v) {
        b.putInt((int) v);
    }

    public static void u64(ByteBuffer b, long v) {
        b.putLong(v);
    }

    public static void viStr(ByteBuffer b, String stratum) {
        byte[] raw = stratum.getBytes(StandardCharsets.UTF_8);
        VarInt.put(b, raw.length);
        b.put(raw);
    }

    public static int u8(ByteBuffer b) {
        return Byte.toUnsignedInt(b.get());
    }

    public static long u32(ByteBuffer b) {
        return Integer.toUnsignedLong(b.getInt());
    }

    public static String viStr(ByteBuffer b) {
        int n = (int) VarInt.get(b);
        byte[] raw = new byte[n];
        b.get(raw);
        return new String(raw, StandardCharsets.UTF_8);
    }

    public static List<Tlv> tail(ByteBuffer b) {
        List<Tlv> out = new ArrayList<>();
        while (b.hasRemaining()) {
            long tag = VarInt.get(b);
            int len = (int) VarInt.get(b);
            byte[] val = new byte[len];
            b.get(val);
            out.add(new Tlv(tag, val));
        }
        return List.copyOf(out);
    }
}
