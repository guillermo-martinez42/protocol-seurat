package seurat.session;

import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.proto.Ranges;

/** LoanBook: annotate-before-open, ack/release, exact expected sets. */
public final class LoanBookTest {
    public static void main(String[] args) {
        annotateBands();
        expectedScrape();
        retainOnly();
        System.out.println("LoanBookTest OK");
    }

    private static void annotateBands() {
        LoanBook book = new LoanBook();
        BrushId p = new BrushId(1, 131, 98);
        TestKit.check(book.bands(p) == 0, "starts empty");
        TestKit.check(book.bands(new BrushId(10, 0, 0)) == 0, "seed absent is 0");
        Delivery a = book.log(p, 0, 2, 1000, 2);
        TestKit.check(a.number() == 1 && book.bands(p) == 2, "annotate [0,2)");
        Delivery b = book.log(p, 2, 4, 900, 2);
        TestKit.check(b.number() == 2 && book.bands(p) == 4, "retouch to 4");
        TestKit.check(book.lastNumber() == 2 && book.size() == 2, "counts");
        book.acknowledge(Ranges.of(1, 2), System.nanoTime(), 120L * 1_000_000_000L, 0);
        book.release(Ranges.of(1));
        TestKit.check(book.size() == 1 && book.contains(2) && !book.contains(1),
                "release drops 1");
        book.cancel(2);
        TestKit.check(book.size() == 0 && book.bands(p) == 0, "cancel clears bands");
    }

    private static void expectedScrape() {
        LoanBook book = new LoanBook();
        for (long n = 1; n <= 256; n++) {
            book.log(new BrushId(1, (int) n, 0), 0, 4, 10, 2);
        }
        for (long n = 257; n <= 284; n++) {
            book.log(new BrushId(0, (int) n, 0), 0, 2, 10, 2);
        }
        Ranges expected = book.expected(289, e -> e.brush().stratum() < 1,
                Ranges.empty());
        Ranges.Builder want = new Ranges.Builder();
        want.addRange(1, 256);
        TestKit.check(expected.equals(want.build()), "§3.4.3 expected [1,256], got "
                + expected.size());
        TestKit.check(book.numbersThrough(289).size() == 284, "numbers through N");
    }

    private static void retainOnly() {
        LoanBook book = new LoanBook();
        for (long n = 1; n <= 10; n++) {
            book.log(new BrushId(2, (int) n, 0), 0, 4, 10, 1);
        }
        Ranges.Builder keep = new Ranges.Builder();
        keep.addRange(1, 5);
        book.retainOnly(10, keep.build());
        TestKit.check(book.size() == 5 && book.numbersThrough(10).equals(keep.build()),
                "retainOnly keeps [1,5]");
    }
}
