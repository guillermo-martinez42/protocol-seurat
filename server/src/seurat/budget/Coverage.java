package seurat.budget;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import seurat.codec.BrushId;
import seurat.store.WorkMeta;

/** Persistent coverage: 4 bits per E0/E1 brush, mmap. Redelivery is free. */
final class Coverage {
    private final ByteBuffer table;
    private final FileChannel channel;
    private final int n0;
    private final int n1;
    private final int w0;
    private final int w1;

    Coverage(Path path, WorkMeta meta) throws IOException {
        w0 = (meta.width() + 255) / 256;
        w1 = (meta.width() / 2 + 255) / 256;
        n0 = w0 * ((meta.height() + 255) / 256);
        n1 = w1 * ((meta.height() / 2 + 255) / 256);
        long bytes = (4L * (n0 + n1) + 1) / 2;
        boolean fresh = !Files.exists(path);
        channel = FileChannel.open(path, StandardOpenOption.CREATE,
                StandardOpenOption.READ, StandardOpenOption.WRITE);
        if (fresh) {
            channel.position(bytes - 1);
            channel.write(ByteBuffer.wrap(new byte[1]));
        }
        table = channel.map(FileChannel.MapMode.READ_WRITE, 0, bytes);
    }

    private int index(BrushId p) {
        if (p.stratum() == 0) {
            return p.by() * w0 + p.bx();
        }
        return n0 + p.by() * w1 + p.bx();
    }

    synchronized int get(BrushId p) {
        int i = index(p);
        int b = table.get(i / 2) & 0xFF;
        return (i % 2 == 0) ? b & 0xF : (b >>> 4) & 0xF;
    }

    synchronized void set(BrushId p, int through) throws IOException {
        int i = index(p);
        int at = i / 2;
        int b = table.get(at) & 0xFF;
        b = (i % 2 == 0) ? (b & 0xF0) | (through & 0xF) : (b & 0xF) | ((through & 0xF) << 4);
        table.put(at, (byte) b);
        channel.force(false);
    }

    synchronized double fraction(int stratum) {
        int n = stratum == 0 ? n0 : n1;
        if (n == 0) {
            return 1;
        }
        int off = stratum == 0 ? 0 : n0;
        int covered = 0;
        for (int i = 0; i < n; i++) {
            int at = (off + i) / 2;
            int b = table.get(at) & 0xFF;
            int v = ((off + i) % 2 == 0) ? b & 0xF : (b >>> 4) & 0xF;
            if (v > 0) {
                covered++;
            }
        }
        return (double) covered / n;
    }
}
