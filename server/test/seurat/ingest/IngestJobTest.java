package seurat.ingest;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import seurat.catalog.Catalog;
import seurat.codec.BrushId;
import seurat.codec.Quant;
import seurat.kit.TestKit;
import seurat.proto.ProtoCodes;
import seurat.store.FileBrushStore;

/** Synthetic master end to end: single pass (no ed1), ed2 close, CRC-verified reads. */
public final class IngestJobTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("ingest-test");
        Path works = root.resolve("obras");
        Catalog catalog = new Catalog(works);
        List<Integer> states = new ArrayList<>();
        catalog.observe(m -> states.add(m.state()));
        Path master = TestKit.masterPng(root, "tiny.png", 512, 384);
        boolean[] ready = {false};
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        java.io.PrintStream ps = new java.io.PrintStream(baos, true, StandardCharsets.UTF_8);
        seurat.observe.Log.setOutput(ps);
        try {
            new IngestJob("tiny", "Tiny", master, works, catalog, () -> ready[0] = true).run();
        } finally {
            seurat.observe.Log.setOutput(System.out);
        }
        TestKit.check(ready[0], "onReady fires");
        String logs = baos.toString(StandardCharsets.UTF_8);
        TestKit.check(logs.contains("Preprocessing for 'tiny' completed in "), "preprocessing log emitted");
        TestKit.check(logs.contains("m ") && logs.contains("s ") && logs.contains("ms"),
                "preprocessing log contains compact units");
        TestKit.check(IngestJob.formatDuration(0).equals("0m 0s 0ms"), "format 0ms");
        TestKit.check(IngestJob.formatDuration(999).equals("0m 0s 999ms"), "format 999ms");
        TestKit.check(IngestJob.formatDuration(65432).equals("1m 5s 432ms"), "format 65432ms");
        var work = catalog.get("tiny");
        TestKit.check(work != null && work.meta.state() == ProtoCodes.ST_LISTA
                && work.meta.edition() == 2, "LISTA ed2");
        TestKit.check(work.meta.strata() == 2, "512x384 -> top 1 -> 2 strata");
        TestKit.check(Files.exists(works.resolve("tiny/semilla.bin")), "seed written");
        TestKit.check(!Files.exists(works.resolve("tiny/ed1")), "no ed1 sketch pass");
        TestKit.check(states.contains(ProtoCodes.ST_PINTANDO)
                && !states.contains(ProtoCodes.ST_BOCETO), "RECIBIENDO -> PINTANDO -> LISTA");
        FileBrushStore store = (FileBrushStore) work.store;
        byte[][] bands = store.bands(new BrushId(0, 0, 0), 0, 4);
        TestKit.check(bands.length == 4, "four bands readable");
        long total = 0;
        for (byte[] band : bands) {
            total += band.length;
        }
        TestKit.check(total > 0, "non-empty brush bytes");
        TestKit.check(store.quantTable == Quant.TABLE, "store records the table it was encoded with");
        TestKit.check(new FileBrushStore(root.resolve("legacy"), work.meta, new int[]{1}, new int[]{1})
                .quantTable == 1, "a store without the marker predates table 2");
        errorMarksFailed(root, works, catalog);
        System.out.println("IngestJobTest OK");
    }

    /** An Error (OOM from a 2^31-1 px gray row buffer) must still end in FALLIDA. */
    private static void errorMarksFailed(Path root, Path works, Catalog catalog) throws Exception {
        ByteBuffer png = ByteBuffer.allocate(33)
                .put(new byte[]{(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'})
                .putInt(13).put("IHDR".getBytes(StandardCharsets.US_ASCII))
                .putInt(Integer.MAX_VALUE).putInt(1).put(new byte[]{8, 0, 0, 0, 0}).putInt(0);
        Path master = Files.write(root.resolve("huge.png"), png.array());
        new IngestJob("huge", "Huge", master, works, catalog, () -> {}).run();
        TestKit.check(catalog.get("huge").meta.state() == ProtoCodes.ST_FALLIDA, "Error -> FALLIDA");
    }
}
