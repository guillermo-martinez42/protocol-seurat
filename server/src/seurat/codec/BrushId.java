package seurat.codec;

import java.util.List;

/** Brush P(stratum,bx,by). id = stratum<<56 | morton. Value object. */
public record BrushId(int stratum, int bx, int by) {
    public long id() {
        return ((long) stratum << 56) | Morton.encode(bx, by);
    }

    public static BrushId ofId(long id) {
        int stratum = (int) (id >>> 56);
        long m = id & 0x00FFFFFFFFFFFFFFL;
        return new BrushId(stratum, Morton.decodeX(m), Morton.decodeY(m));
    }

    public BrushId parent() {
        return new BrushId(stratum + 1, bx >> 1, by >> 1);
    }

    /** Nearest ancestor that exists in a work with the given top (else seed). */
    public BrushId parentCapped(int top) {
        BrushId q = parent();
        while (q.stratum() < 10 && q.stratum() >= top) {
            q = q.parent();
        }
        return q.stratum() >= 10 ? new BrushId(10, 0, 0) : q;
    }

    public List<BrushId> children() {
        if (stratum == 0) {
            return List.of();
        }
        int cx = bx << 1;
        int cy = by << 1;
        return List.of(new BrushId(stratum - 1, cx, cy), new BrushId(stratum - 1, cx + 1, cy),
                new BrushId(stratum - 1, cx, cy + 1), new BrushId(stratum - 1, cx + 1, cy + 1));
    }

    /** Native pixel footprint [x0,x1) x [y0,y1). */
    public long[] footprint() {
        long f = 256L << stratum;
        return new long[]{(long) bx * f, (long) by * f, (long) (bx + 1) * f, (long) (by + 1) * f};
    }
}
