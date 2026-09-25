package seurat.paint;

import java.util.List;
import seurat.plan.PlanEntry;

/** Result of applying budget to a planned delivery sequence. */
public record BudgetedPlan(List<PlanEntry> entries, int throttle) {}
