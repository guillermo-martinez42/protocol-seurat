package seurat.store;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/**
 * Ingest write path: persistent channels per stratum, bytes first and the
 * index entry as the commit. close() fsyncs everything.
 */
final class StoreWriter {
    private final Path dir;
    private final int[] nx;
    private FileChannel[] pincChannels;
    private FileChannel[] idxChannels;
    private long[] pincSizes;
    private final ByteBuffer idxBuf = ByteBuffer.allocate(IndexEntry.BYTES);

    StoreWriter(Path dir, int[] nx) {
        this.dir = dir;
        this.nx = nx.clone();
    }

    /** Crash rule: truncate every .pinc to the max indexed end. */
    static void recover(Path dir, int[] nx) throws IOException {
        for (int stratum = 0; stratum < nx.length; stratum++) {
            Path pi = dir.resolve("E" + stratum + ".idx");
            Path pp = dir.resolve("E" + stratum + ".pinc");
            if (!java.nio.file.Files.exists(pi) || !java.nio.file.Files.exists(pp)) {
                continue;
            }
            long max = 0;
            try (FileChannel ch = FileChannel.open(pi, StandardOpenOption.READ)) {
                ByteBuffer b = ByteBuffer.allocate(64 * 1024);
                while (ch.read(b) > 0) {
                    b.flip();
                    while (b.remaining() >= IndexEntry.BYTES) {
                        IndexEntry e = IndexEntry.decode(b);
                        if (!e.isMissing()) {
                            max = Math.max(max, e.offset() + e.ends()[3]);
                        }
                    }
                    b.compact();
                }
            }
            try (FileChannel ch = FileChannel.open(pp, StandardOpenOption.WRITE)) {
                if (ch.size() > max) {
                    ch.truncate(max);
                }
            }
        }
    }

    private void channels(int stratum) throws IOException {
        if (pincChannels == null) {
            pincChannels = new FileChannel[nx.length];
            idxChannels = new FileChannel[nx.length];
            pincSizes = new long[nx.length];
        }
        if (pincChannels[stratum] == null) {
            FileChannel pinc = FileChannel.open(dir.resolve("E" + stratum + ".pinc"),
                    StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                    StandardOpenOption.READ);
            pincSizes[stratum] = pinc.size();
            pinc.position(pincSizes[stratum]);
            pincChannels[stratum] = pinc;
            idxChannels[stratum] = FileChannel.open(dir.resolve("E" + stratum + ".idx"),
                    StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                    StandardOpenOption.READ);
        }
    }

    synchronized void append(int stratum, int bx, int by, byte[][] bands,
            long[] crcs) throws IOException {
        channels(stratum);
        long slot = (long) by * nx[stratum] + bx;
        long off = pincSizes[stratum];
        long[] ends = new long[4];
        long acc = 0;
        ByteBuffer[] bufs = new ByteBuffer[bands.length];
        for (int i = 0; i < bands.length; i++) {
            byte[] band = bands[i];
            if (band != null && band.length > 0) {
                bufs[i] = ByteBuffer.wrap(band);
                acc += band.length;
            } else {
                bufs[i] = ByteBuffer.allocate(0);
            }
            ends[i] = acc;
        }
        pincChannels[stratum].write(bufs, 0, bufs.length);
        pincSizes[stratum] = off + acc;

        long at = slot * IndexEntry.BYTES;
        idxBuf.clear();
        idxBuf.putLong(off);
        for (int i = 0; i < 4; i++) {
            idxBuf.putInt((int) ends[i]);
        }
        for (int i = 0; i < 4; i++) {
            idxBuf.putInt((int) (i < crcs.length ? crcs[i] : 0));
        }
        idxBuf.flip();
        idxChannels[stratum].write(idxBuf, at);
    }

    synchronized void close() throws IOException {
        if (pincChannels != null) {
            for (int stratum = 0; stratum < pincChannels.length; stratum++) {
                if (pincChannels[stratum] != null) {
                    pincChannels[stratum].force(true);
                    idxChannels[stratum].force(true);
                    pincChannels[stratum].close();
                    idxChannels[stratum].close();
                }
            }
            pincChannels = null;
            idxChannels = null;
        }
    }
}
