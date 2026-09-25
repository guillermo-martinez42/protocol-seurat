package seurat.proto;

import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.List;

/** RFC 9000 §19.3.1 SACK ranges wire codec. largest=0 is empty set. */
public final class RangesCodec {
    private RangesCodec() {}

    public static byte[] encode(Ranges ranges) {
        if (ranges.isEmpty()) {
            return new byte[]{0x00, 0x00, 0x00};
        }
        List<long[]> t = ranges.spans();
        Collections.reverse(t);
        ByteBuffer b = ByteBuffer.allocate(8 * (2 * t.size() + 1));
        VarInt.put(b, t.get(0)[1]);
        VarInt.put(b, t.size() - 1);
        VarInt.put(b, t.get(0)[1] - t.get(0)[0]);
        for (int i = 1; i < t.size(); i++) {
            long prevLo = t.get(i - 1)[0];
            long hi = t.get(i)[1];
            long lo = t.get(i)[0];
            VarInt.put(b, prevLo - hi - 2);
            VarInt.put(b, hi - lo);
        }
        byte[] out = new byte[b.position()];
        b.flip();
        b.get(out);
        return out;
    }

    public static Ranges decode(ByteBuffer b) {
        long largest = VarInt.get(b);
        Ranges.Builder out = new Ranges.Builder();
        if (largest == 0) {
            VarInt.get(b); // n_huecos (0)
            VarInt.get(b); // primer_rango (0)
            return out.build();
        }
        long huecos = VarInt.get(b);
        long first = VarInt.get(b);
        out.addRange(largest - first, largest);
        long menor = largest - first;
        for (long i = 0; i < huecos; i++) {
            long hueco = VarInt.get(b);
            long largo = VarInt.get(b);
            long hi = menor - hueco - 2;
            out.addRange(hi - largo, hi);
            menor = hi - largo;
        }
        return out.build();
    }
}
