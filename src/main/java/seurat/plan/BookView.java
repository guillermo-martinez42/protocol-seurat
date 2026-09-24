package seurat.plan;

import seurat.codec.BrushId;

/** Read view of held bands. Implemented by callers over LoanBook. */
public interface BookView {
    int bands(BrushId p);
}
