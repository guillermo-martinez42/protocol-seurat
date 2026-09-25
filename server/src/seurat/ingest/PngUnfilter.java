package seurat.ingest;

/** PNG scanline unfiltering and RGB decoding. Pure, no IO. */
final class PngUnfilter {
    private PngUnfilter() {}

    static void unfilter(int filter, byte[] cur, byte[] prev, int bpp, int len) {
        switch (filter) {
            case 1 -> {
                for (int i = bpp; i < len; i++) {
                    cur[i] = (byte) ((cur[i] & 0xFF) + (cur[i - bpp] & 0xFF));
                }
            }
            case 2 -> {
                for (int i = 0; i < len; i++) {
                    cur[i] = (byte) ((cur[i] & 0xFF) + (prev[i] & 0xFF));
                }
            }
            case 3 -> {
                for (int i = 0; i < bpp; i++) {
                    cur[i] = (byte) ((cur[i] & 0xFF) + ((prev[i] & 0xFF) >> 1));
                }
                for (int i = bpp; i < len; i++) {
                    int a = cur[i - bpp] & 0xFF;
                    int b = prev[i] & 0xFF;
                    cur[i] = (byte) ((cur[i] & 0xFF) + ((a + b) >> 1));
                }
            }
            case 4 -> {
                for (int i = 0; i < bpp; i++) {
                    cur[i] = (byte) ((cur[i] & 0xFF) + (prev[i] & 0xFF));
                }
                for (int i = bpp; i < len; i++) {
                    int a = cur[i - bpp] & 0xFF;
                    int b = prev[i] & 0xFF;
                    int c = prev[i - bpp] & 0xFF;
                    int p = a + b - c;
                    int pa = Math.abs(p - a);
                    int pb = Math.abs(p - b);
                    int pc = Math.abs(p - c);
                    cur[i] = (byte) ((cur[i] & 0xFF) + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)));
                }
            }
            default -> {}
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
