package seurat.catalog;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import seurat.kit.TestKit;
import seurat.proto.MsgCatalog;
import seurat.proto.ProtoCodes;
import seurat.store.WorkMeta;

/** Catalog: register/progress/ready/withdraw push OBRA to observers. */
public final class CatalogTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("catalog-test");
        Catalog catalog = new Catalog(root);
        var seen = new ArrayList<MsgCatalog.WorkMessage>();
        catalog.observe(seen::add);
        var meta = new WorkMeta("w1", "Work 1", 512, 512, 256, 2, 0, 1, 0, 2);
        catalog.register(new WorkRecord(meta));
        TestKit.check(seen.size() == 1 && seen.get(0).event() == ProtoCodes.OBRA_ALTA,
                "ALTA pushed");
        TestKit.check(Files.exists(root.resolve("w1/meta.json")), "meta.json persisted");
        catalog.progress("w1", 42);
        TestKit.check(seen.size() == 2 && seen.get(1).progress() == 42,
                "first progress pushes ESTADO (put returns null)");
        catalog.progress("w1", 42);
        TestKit.check(seen.size() == 2, "same pct not re-emitted");
        catalog.progress("w1", 57);
        TestKit.check(seen.size() == 3 && seen.get(2).progress() == 57, "changed pct emits");
        catalog.list("w1");
        TestKit.check(seen.size() == 4 && seen.get(3).event() == ProtoCodes.OBRA_EDICION,
                "EDICION pushed");
        catalog.withdraw("w1");
        TestKit.check(seen.size() == 5 && seen.get(4).event() == ProtoCodes.OBRA_BAJA
                && catalog.get("w1") == null, "BAJA pushed + removed");
        catalog.progress("missing", 1);
        TestKit.check(seen.size() == 5, "unknown id silent");
        testLoadRecovery();
        System.out.println("CatalogTest OK");
    }

    private static void testLoadRecovery() throws Exception {
        Path root = Files.createTempDirectory("catalog-load-test");
        Catalog catalog = new Catalog(root);
        WorkMeta m0 = new WorkMeta("r0", "R0", 0, 0, 256, 0, ProtoCodes.ST_RECIBIENDO, 1, 0, 2);
        catalog.register(new WorkRecord(m0));
        WorkMeta m1 = new WorkMeta("w1", "W1", 512, 512, 256, 2, ProtoCodes.ST_LISTA, 1, 0, 2);
        catalog.register(new WorkRecord(m1));
        WorkMeta m1dup = new WorkMeta("w1.png", "W1", 512, 512, 256, 2, ProtoCodes.ST_LISTA, 1, 0, 2);
        catalog.register(new WorkRecord(m1dup));

        Catalog loaded = new Catalog(root);
        loaded.load();
        TestKit.check(loaded.get("r0") != null, "loaded r0");
        TestKit.check(loaded.get("r0").store == null, "r0 has no store");
        TestKit.check(loaded.get("w1") != null, "loaded w1");
        TestKit.check(loaded.get("w1.png") == null, "w1.png deduplicated");
    }
}
