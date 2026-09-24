package seurat.proto;

import java.nio.ByteBuffer;
import seurat.config.SeuratConstants;

/** Control frame: type/largo/payload. >64KiB is fail. */
public record Frame(long type, byte[] payload) {
    public byte[] encode() {
        byte[] t = VarInt.encode(type);
        byte[] canvas = VarInt.encode(payload.length);
        byte[] out = new byte[t.length + canvas.length + payload.length];
        System.arraycopy(t, 0, out, 0, t.length);
        System.arraycopy(canvas, 0, out, t.length, canvas.length);
        System.arraycopy(payload, 0, out, t.length + canvas.length, payload.length);
        return out;
    }

    public static Frame decode(ByteBuffer b) {
        long type = VarInt.get(b);
        long largo = VarInt.get(b);
        if (largo > SeuratConstants.FRAME_MAX) {
            throw new FatalProtocol(1, type, "trama >64KiB");
        }
        byte[] payload = new byte[(int) largo];
        b.get(payload);
        return new Frame(type, payload);
    }

    public static boolean mandatory(long type) {
        return type < 0x40;
    }
}
