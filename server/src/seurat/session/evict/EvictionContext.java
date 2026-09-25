package seurat.session.evict;

/** Pressure snapshot that triggered voluntary eviction (§5.2.3). */
public record EvictionContext(
        int ownedBrushes,
        int maxBrushes,
        int ownedKib,
        int maxKib,
        boolean vramReserveFailed) {
    public boolean pressured() {
        boolean count = ownedBrushes + EvictionConstants.HEADROOM_BRUSHES >= maxBrushes;
        boolean bytes = (long) ownedKib * EvictionConstants.PRESSURE_DEN
                >= (long) maxKib * EvictionConstants.PRESSURE_NUM;
        return count || bytes || vramReserveFailed;
    }
}
