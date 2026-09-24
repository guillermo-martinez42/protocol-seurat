package seurat.ingest;

/** PNG scanline unfiltering and RGB decoding. Pure, no IO. */
final class PngUnfilter {
    private PngUnfilter() {}

    static void unfilter(int filter, byte[] cur, byte[] prev, int bpp, int len) {
        for (int i = 0; i < len; i++) {
            int a = i >= bpp ? (cur[i - bpp] & 0xFF) : 0;
            int b = prev[i] & 0xFF;
            int c = (i >= bpp) ? (prev[i - bpp] & 0xFF) : 0;
            int val = cur[i] & 0xFF;
            cur[i] = (byte) switch (filter) {
                case 1 -> (val + a) & 0xFF;
                case 2 -> (val + b) & 0xFF;
                case 3 -> (val + ((a + b) >> 1)) & 0xFF;
                case 4 -> {
                    int p = a + b - c;
                    int pa = Math.abs(p - a);
                    int pb = Math.abs(p - b);
                    int pc = Math.abs(p - c);
                    yield (val + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 0xFF;
                }
                default -> val;
            };
        }
    }

    static void decodeRgb(byte[] raw, int[] out, int ct, int w) {
        if (ct == 2) {
            for (int x = 0; x < w; x++) {
                out[x] = 0xFF000000 | ((raw[x * 3] & 0xFF) << 16)
                        | ((raw[x * 3 + 1] & 0xFF) << 8) | (raw[x * 3 + 2] & 0xFF);
            }
        } else if (ct == 6) {
            for (int x = 0; x < w; x++) {
                out[x] = ((raw[x * 4 + 3] & 0xFF) << 24) | ((raw[x * 4] & 0xFF) << 16)
                        | ((raw[x * 4 + 1] & 0xFF) << 8) | (raw[x * 4 + 2] & 0xFF);
            }
        } else {
            for (int x = 0; x < w; x++) {
                int v = raw[x] & 0xFF;
                out[x] = 0xFF000000 | (v << 16) | (v << 8) | v;
            }
        }
    }
}
