package seurat.codec;

/** Morton interleave: x on even bits, y on odd. Parent is >>2. */
public final class Morton {
    private Morton() {}

    public static long encode(int x, int y) {
        long m = 0;
        for (int i = 0; i < 28; i++) {
            if ((x & (1 << i)) != 0) {
                m |= 1L << (2 * i);
            }
            if ((y & (1 << i)) != 0) {
                m |= 1L << (2 * i + 1);
            }
        }
        return m;
    }

    public static int decodeX(long m) {
        int x = 0;
        for (int i = 0; i < 28; i++) {
            if ((m & (1L << (2 * i))) != 0) {
                x |= 1 << i;
            }
        }
        return x;
    }

    public static int decodeY(long m) {
        int y = 0;
        for (int i = 0; i < 28; i++) {
            if ((m & (1L << (2 * i + 1))) != 0) {
                y |= 1 << i;
            }
        }
        return y;
    }
}
