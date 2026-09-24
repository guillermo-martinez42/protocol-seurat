package seurat.proto;

import java.nio.ByteBuffer;
import seurat.kit.TestKit;

/** SACK ranges: §3.4.2 RECIBO, §3.4.3 RASPADO, §3.4.4 RENOVAR vectors. */
public final class RangesTest {
    public static void main(String[] args) {
        empty();
        recibo();
        raspado();
        renovar();
        equality();
        System.out.println("RangesTest OK");
    }

    private static void empty() {
        Ranges r = Ranges.decode(ByteBuffer.wrap(new byte[]{0x00, 0x00, 0x00}));
        TestKit.check(r.isEmpty() && r.largest() == 0, "mayor 0 is empty");
        TestKit.check(Ranges.empty().encode().length == 3, "empty encodes 3B");
    }

    private static void recibo() {
        Ranges r = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("3c01070006")));
        TestKit.check(r.contains(45) && r.contains(51) && r.contains(53)
                && r.contains(60), "recibo members");
        TestKit.check(!r.contains(52) && !r.contains(44) && !r.contains(61),
                "recibo gaps");
        TestKit.check(r.largest() == 60 && r.size() == 15, "recibo size 7+8=15");
        TestKit.check(Ranges.decode(ByteBuffer.wrap(r.encode())).equals(r), "round-trip");
    }

    private static void raspado() {
        Ranges r = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("41000040ff")));
        TestKit.check(r.size() == 256 && r.contains(1) && r.contains(256)
                && !r.contains(257), "[1,256]");
    }

    private static void renovar() {
        Ranges r = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("4150012e2040ff")));
        TestKit.check(r.contains(1) && r.contains(256) && r.contains(290)
                && r.contains(336), "renovar members");
        TestKit.check(!r.contains(257) && !r.contains(289), "renovar gaps");
        TestKit.check(r.size() == 256 + 47, "renovar size 303");
    }

    private static void equality() {
        Ranges.Builder b = new Ranges.Builder();
        b.addRange(1, 256);
        TestKit.check(!b.build().equals(Ranges.of()), "empty != full");
        Ranges.Builder c = new Ranges.Builder();
        for (long n = 1; n <= 256; n++) {
            c.add(n);
        }
        TestKit.check(b.build().equals(c.build()), "range == pointwise");
    }
}
