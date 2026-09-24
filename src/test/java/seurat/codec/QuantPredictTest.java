package seurat.codec;

import seurat.kit.TestKit;

/** Dead-zone quantizer + per-stratum table + S+P prediction smoke. */
public final class QuantPredictTest {
    public static void main(String[] args) {
        deadZone();
        table();
        prediction();
        System.out.println("QuantPredictTest OK");
    }

    private static void deadZone() {
        TestKit.check(Quant.quantize(0, 6) == 0, "zero stays zero");
        TestKit.check(Quant.quantize(5, 6) == 0, "dead zone");
        TestKit.check(Quant.quantize(6, 6) == 1, "boundary");
        TestKit.check(Quant.quantize(-13, 6) == -2, "negative");
        TestKit.check(Quant.dequantize(0, 6) == 0, "dequant zero");
        TestKit.check(Quant.dequantize(2, 6) == 15, "dequant 2*6+3");
        TestKit.check(Quant.quantize(99, 0) == 0, "q<=0 kills chroma");
        for (int x = -500; x <= 500; x++) {
            int q = 4;
            int i = Quant.quantize(x, q);
            int back = Quant.dequantize(i, q);
            TestKit.check(Math.abs(back - x) <= q, "error bounded by q");
        }
    }

    private static void table() {
        TestKit.check(Quant.qy(0) == 6 && Quant.qc(0) == 0, "s0 4:2:0");
        TestKit.check(Quant.qy(1) == 4 && Quant.qc(1) == 6, "s1");
        TestKit.check(Quant.qy(2) == 2 && Quant.qc(2) == 3, "s2");
        TestKit.check(Quant.qy(5) == 1 && Quant.qc(5) == 2, "s>=3");
    }

    private static void prediction() {
        int w = 8;
        int h = 8;
        int[] parents = new int[w * h];
        for (int i = 0; i < parents.length; i++) {
            parents[i] = (i * 37) & 0xFF;
        }
        int hh = PredictSP.hHat(parents, w, h, 3, 3);
        int vv = PredictSP.vHat(parents, w, h, 3, 3);
        int expectedH = 44; // (191-15+2)>>2
        TestKit.check(hh == expectedH, "hHat formula, got " + hh);
        TestKit.check(PredictSP.hHat(parents, w, h, 0, 0)
                == PredictSP.hHat(parents, w, h, 0, 0), "edge deterministic");
        TestKit.check(Math.abs(vv) < 256, "vHat bounded");
    }
}
