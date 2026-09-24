package seurat.paint;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import seurat.budget.BrushBudget;
import seurat.codec.BrushId;
import seurat.plan.PlanEntry;
import seurat.proto.ProtoCodes;
import seurat.session.Canvas;

/**
 * Budget finalize before PLAN START: consume-or-substitute the parent stratum
 * for stratum <= 1. Substitutes once per parent, only into existing strata.
 */
final class BudgetApplier {
    private final BrushBudget budget;

    BudgetApplier(BrushBudget budget) {
        this.budget = budget;
    }

    BudgetedPlan apply(Canvas canvas, List<PlanEntry> entries) {
        List<PlanEntry> done = new ArrayList<>(entries.size());
        Set<BrushId> added = new HashSet<>();
        int flags = 0;
        var session = canvas.session();
        int top = canvas.meta().strata() - 1;
        for (PlanEntry entry : entries) {
            BrushId brush = entry.brush();
            if (brush.stratum() <= 1 && !budget.consume(session.principal(),
                    canvas.workId(), brush, entry.from(), entry.through(),
                    session.role(), canvas.meta())) {
                flags |= ProtoCodes.REG_PRESUPUESTO;
                BrushId parent = brush.parent();
                if (parent.stratum() >= top || canvas.book().bands(parent)
                        >= entry.through() || !added.add(parent)) {
                    continue;
                }
                if (canvas.concession().allows(parent, entry.through())
                        && budget.consume(session.principal(), canvas.workId(), parent,
                                canvas.book().bands(parent), entry.through(),
                                session.role(), canvas.meta())) {
                    done.add(new PlanEntry(parent, canvas.book().bands(parent),
                            entry.through(), entry.pass()));
                }
                continue;
            }
            if (added.add(brush)) {
                done.add(entry);
            }
        }
        return new BudgetedPlan(done, flags);
    }
}
