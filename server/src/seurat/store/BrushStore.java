package seurat.store;

import java.io.IOException;
import java.io.OutputStream;
import seurat.codec.BrushId;

/** Positional reads over immutable per-edition brush bytes. */
public interface BrushStore {
    /** Full band interval [b0,b1) bytes for a brush. Prefix reads are cheap. */
    byte[][] bands(BrushId p, int b0, int b1) throws IOException;

    /** Copies [b0,b1) bytes to out. Verifies CRC-32C on read. */
    void copy(BrushId p, int b0, int b1, OutputStream out) throws IOException;

    /** Total bytes of [b0,b1). */
    long bytes(BrushId p, int b0, int b1) throws IOException;

    WorkMeta meta();
}
