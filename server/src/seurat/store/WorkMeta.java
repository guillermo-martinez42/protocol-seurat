package seurat.store;

/** Work metadata: mirrors meta.json. */
public record WorkMeta(String id, String name, int width, int height, int side,
        int strata, int state, long edition, long ceilingStratum, long ceilingBands) {}
