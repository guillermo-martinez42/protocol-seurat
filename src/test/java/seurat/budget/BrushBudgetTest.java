package seurat.budget;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.WorkRecord;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.store.WorkMeta;

/** Budget: first serve charges, redelivery free, caps stop sweeps. */
public final class BrushBudgetTest {
    static WorkMeta meta() {
        return new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2, 0, 2);
    }

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("budget-test");
        chargeAndFree(root);
        capStopsSweep(root);
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

    private static void capStopsSweep(Path root) throws Exception {
        BrushBudget budget = new BrushBudget(root.resolve("b"));
        int allowed = 0;
        for (int bx = 0; bx < 2; bx++) {
            for (int by = 0; by < 2; by++) {
                if (budget.consume("anon", "w", new BrushId(1, bx, by), 0, 4,
                        WorkRecord.ANONYMOUS, meta())) {
                    allowed++;
                }
            }
        }
        TestKit.check(allowed == 1, "anon s1 capped at 25% of 4, got " + allowed);
        TestKit.check(!budget.consume("anon", "w", new BrushId(0, 0, 0), 0, 4,
                WorkRecord.ANONYMOUS, meta()), "anon s0 never served");
    }
}
