package seurat.store;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.CRC32C;
import seurat.codec.BrushId;
import seurat.config.SeuratConstants;
import seurat.observe.AuditLog;

/**
 * E{stratum}.pinc (append-only) + E{stratum}.idx (40B). Bytes first, index = commit.
 * Writes use persistent channels; close() fsyncs. On open, .pinc is
 * truncated to the max indexed end (crash rule).
 */
public final class FileBrushStore implements BrushStore {
    private final Path dir;
    private final WorkMeta meta;
    private final int[] nx;
    private final StoreWriter writer;

    public FileBrushStore(Path dir, WorkMeta meta, int[] nx, int[] ny) throws IOException {
        this.dir = dir;
        this.meta = meta;
        this.nx = nx.clone();
        Files.createDirectories(dir);
        StoreWriter.recover(dir, nx);
        writer = new StoreWriter(dir, nx);
    }

    public Path dir() {
        return dir;
    }

    private Path pincPath(int stratum) {
        return dir.resolve("E" + stratum + ".pinc");
    }

    private Path idxPath(int stratum) {
        return dir.resolve("E" + stratum + ".idx");
    }

    /** Append path for ingest: bytes then index entry. */
    public void append(int stratum, int bx, int by, byte[][] bands,
            long[] crcs) throws IOException {
        writer.append(stratum, bx, by, bands, crcs);
    }

    public void close() throws IOException {
        writer.close();
    }

    private IndexEntry entry(BrushId p) throws IOException {
        int stratum = p.stratum();
        if (stratum >= nx.length) {
            return IndexEntry.missing();
        }
        long slot = (long) p.by() * nx[stratum] + p.bx();
        Path path = idxPath(stratum);
        if (!Files.exists(path)) {
            return IndexEntry.missing();
        }
        try (FileChannel ch = FileChannel.open(path, StandardOpenOption.READ)) {
            ByteBuffer b = ByteBuffer.allocate(IndexEntry.BYTES);
            if (ch.read(b, slot * IndexEntry.BYTES) < IndexEntry.BYTES) {
                return IndexEntry.missing();
            }
            b.flip();
            return IndexEntry.decode(b);
        }
    }

    @Override
    public byte[][] bands(BrushId p, int b0, int b1) throws IOException {
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            byte[] seed = Files.readAllBytes(dir.resolve("semilla.bin"));
            return new byte[][]{java.util.Arrays.copyOfRange(seed, 4, seed.length)};
        }
        IndexEntry e = entry(p);
        if (e.isMissing()) {
            throw new IOException("brush ausente " + p);
        }
        byte[][] out = new byte[b1 - b0][];
        if (e.isEmpty()) {
            for (int i = 0; i < out.length; i++) {
                out[i] = new byte[0];
            }
            return out;
        }
        try (FileChannel ch = FileChannel.open(pincPath(p.stratum()), StandardOpenOption.READ)) {
            for (int i = b0; i < b1; i++) {
                long from = i == 0 ? 0 : e.ends()[i - 1];
                byte[] raw = new byte[(int) (e.ends()[i] - from)];
                ch.read(ByteBuffer.wrap(raw), e.offset() + from);
                verify(raw, e.crcs()[i], p, i);
                out[i - b0] = raw;
            }
        }
        return out;
    }

    private void verify(byte[] raw, long crc, BrushId p, int band) throws IOException {
        CRC32C c = new CRC32C();
        c.update(raw);
        if (c.getValue() != crc) {
            AuditLog.alert("band corrupta " + p + " band=" + band + ": prefijo valido");
            throw new IOException("CRC band " + band + " de " + p);
        }
    }

    @Override
    public void copy(BrushId p, int b0, int b1, OutputStream out) throws IOException {
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            byte[] seed = Files.readAllBytes(dir.resolve("semilla.bin"));
            out.write(seed, 4, seed.length - 4);
            return;
        }
        for (byte[] band : bands(p, b0, b1)) {
            out.write(band);
        }
    }

    @Override
    public long bytes(BrushId p, int b0, int b1) throws IOException {
        if (p.stratum() == SeuratConstants.SEED_STRATUM) {
            return Files.size(dir.resolve("semilla.bin")) - 4;
        }
        IndexEntry e = entry(p);
        if (e.isMissing()) {
            throw new IOException("brush ausente " + p);
        }
        return e.ends()[b1 - 1] - (b0 == 0 ? 0 : e.ends()[b0 - 1]);
    }

    @Override
    public WorkMeta meta() {
        return meta;
    }
}
