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
                ByteBuffer b = ByteBuffer.allocate(IndexEntry.BYTES);
                while (true) {
                    b.clear();
                    if (ch.read(b) < IndexEntry.BYTES) {
                        break;
                    }
                    b.flip();
                    IndexEntry e = IndexEntry.decode(b);
                    if (!e.isMissing()) {
                        max = Math.max(max, e.offset() + e.ends()[3]);
                    }
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
        }
        if (pincChannels[stratum] == null) {
            pincChannels[stratum] = FileChannel.open(dir.resolve("E" + stratum + ".pinc"),
                    StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                    StandardOpenOption.READ);
            idxChannels[stratum] = FileChannel.open(dir.resolve("E" + stratum + ".idx"),
                    StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                    StandardOpenOption.READ);
        }
    }

    synchronized void append(int stratum, int bx, int by, byte[][] bands,
            long[] crcs) throws IOException {
        channels(stratum);
        long slot = (long) by * nx[stratum] + bx;
        long off = pincChannels[stratum].size();
        long[] ends = new long[4];
        long acc = 0;
        for (int i = 0; i < 4; i++) {
            byte[] band = i < bands.length ? bands[i] : null;
            if (band != null) {
                pincChannels[stratum].write(ByteBuffer.wrap(band), off + acc);
                acc += band.length;
            }
            ends[i] = acc;
        }
        long at = slot * IndexEntry.BYTES;
        if (idxChannels[stratum].size() < at + IndexEntry.BYTES) {
            idxChannels[stratum].position(idxChannels[stratum].size());
            ByteBuffer fill = ByteBuffer.allocate(IndexEntry.BYTES);
            while (idxChannels[stratum].size() < at + IndexEntry.BYTES) {
                fill.clear();
                idxChannels[stratum].write(fill);
            }
        }
        idxChannels[stratum].write(
                ByteBuffer.wrap(new IndexEntry(off, ends, crcs).encode()), at);
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
