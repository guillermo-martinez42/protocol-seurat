package seurat.ingest;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.Catalog;
import seurat.codec.BrushId;
import seurat.codec.Quant;
import seurat.kit.TestKit;
import seurat.proto.ProtoCodes;
import seurat.store.FileBrushStore;

/** Synthetic master end to end: ed1 sketch, ed2 close, CRC-verified reads. */
public final class IngestJobTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("ingest-test");
        Path works = root.resolve("obras");
        Catalog catalog = new Catalog(works);
        Path master = TestKit.masterPng(root, "tiny.png", 512, 384);
        boolean[] ready = {false};
        new IngestJob("tiny", "Tiny", master, works, catalog, () -> ready[0] = true).run();
        TestKit.check(ready[0], "onReady fires");
        var work = catalog.get("tiny");
        TestKit.check(work != null && work.meta.state() == ProtoCodes.ST_LISTA
                && work.meta.edition() == 2, "LISTA ed2");
        TestKit.check(work.meta.strata() == 2, "512x384 -> top 1 -> 2 strata");
        TestKit.check(Files.exists(works.resolve("tiny/semilla.bin")), "seed written");
        TestKit.check(Files.exists(works.resolve("tiny/ed1/E0.pinc")), "ed1 kept");
        FileBrushStore store = (FileBrushStore) work.store;
        byte[][] bands = store.bands(new BrushId(0, 0, 0), 0, 4);
        TestKit.check(bands.length == 4, "four bands readable");
        long total = 0;
        for (byte[] band : bands) {
            total += band.length;
        }
        TestKit.check(total > 0, "non-empty brush bytes");
        TestKit.check(Quant.qy(0) == 6 && Quant.qc(0) == 0, "s0 table");
        System.out.println("IngestJobTest OK");
    }
}
