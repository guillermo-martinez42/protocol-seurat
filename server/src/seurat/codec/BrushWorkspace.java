package seurat.codec;

import java.util.zip.CRC32C;
import java.util.zip.Deflater;

/** Reusable thread-local workspace for zero-allocation brush encoding. */
final class BrushWorkspace {
    static final int N = 16384;
    static final int[] MORTON_16K = new int[N];

    static {
        for (int i = 0; i < N; i++) {
            MORTON_16K[i] = (int) Morton.encode(i % 128, i / 128);
        }
    }

    final int[][][] q = new int[3][3][N];
    final int[] energy = new int[N];
    final long[] sortPacked = new long[N];
    final int[] rank = new int[N];
    final byte[] rawBuf = new byte[512 * 1024];
    final byte[] compBuf = new byte[512 * 1024];
    final CRC32C crc = new CRC32C();
    final Deflater deflater = new Deflater(seurat.config.SeuratConstants.DEFLATE_LEVEL, true);

    static final ThreadLocal<BrushWorkspace> LOCAL = ThreadLocal.withInitial(BrushWorkspace::new);
}
