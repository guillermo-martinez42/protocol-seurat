package seurat.budget;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.WorkRecord;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.store.WorkMeta;

/** Budget: first serve charges, redelivery free, the band bucket stops sweeps. */
public final class BrushBudgetTest {
    static WorkMeta meta() {
        return new WorkMeta("w", "w", 1024, 1024, 256, 11, 3, 2, 0, 2);
    }

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("budget-test");
        chargeAndFree(root);
        bucketStopsSweep(root);
        System.out.println("BrushBudgetTest OK");
    }

    private static void chargeAndFree(Path root) throws Exception {
        BrushBudget budget = new BrushBudget(root.resolve("a"));
        BrushId p = new BrushId(0, 0, 0);
        TestKit.check(budget.consume("u", "w", p, 0, 2, WorkRecord.AUTHENTICATED, meta()),
                "first serve charged");
        TestKit.check(budget.consume("u", "w", p, 0, 2, WorkRecord.AUTHENTICATED, meta()),
                "redelivery free");
        TestKit.check(budget.consume("u", "w", p, 0, 4, WorkRecord.PRIVILEGED, meta()),
                "upper bands charge once");
        TestKit.check(new BrushBudget(root.resolve("a"))
                .consume("u", "w", p, 0, 2, WorkRecord.AUTHENTICATED, meta()),
                "coverage persists");
    }

    /** Anonymous zooms to full detail on a nested work id; the band bucket still stops a sweep. */
    private static void bucketStopsSweep(Path root) throws Exception {
        BrushBudget budget = new BrushBudget(root.resolve("b"));
        var big = new WorkMeta("img/big", "big", 65536, 65536, 256, 9, 3, 2, 0, 2);
        int served = 0;
        while (served < 20_000 && budget.consume("anonimo", "img/big",
                new BrushId(0, served % 256, served / 256), 0, 4, WorkRecord.ANONYMOUS, big)) {
            served++;
        }
        TestKit.check(served > 1000, "anonymous gets level 0 x 4 bands (nested id), got " + served);
        TestKit.check(served < 20_000, "band bucket stops a bulk sweep, got " + served);
    }
}
