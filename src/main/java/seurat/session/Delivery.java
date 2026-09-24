package seurat.session;

import seurat.codec.BrushId;

/** One numbered loan on a canvas. Numbering starts at 1, monotone. */
public record Delivery(long number, BrushId brush, int from, int through,
        int bytes, long epoch) {}
