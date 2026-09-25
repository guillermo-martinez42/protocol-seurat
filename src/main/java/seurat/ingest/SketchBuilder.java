package seurat.ingest;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import seurat.codec.BrushEncoder;
import seurat.codec.Quant;
import seurat.codec.SeedCodec;
import seurat.codec.TransformS;
import seurat.codec.YCoCgR;
import seurat.store.FileBrushStore;

/**
 * ed1 sketch: subsampled master -> E7 -> S-pyramid -> zero-detail brushes
 * for s7..9 + seed. Servable while the full pass runs.
 */
final class SketchBuilder {
    private SketchBuilder() {}

    static void build(Path master, FileBrushStore store, int top) throws Exception {
        try (ImageInputStream in = ImageIO.createImageInputStream(master.toFile())) {
            Iterator<ImageReader> it = ImageIO.getImageReaders(in);
            if (!it.hasNext()) {
                return;
            }
            ImageReader reader = it.next();
            reader.setInput(in);
            int q = 1 << Math.max(0, top - 3);
            var param = reader.getDefaultReadParam();
            param.setSourceSubsampling(q, q, 0, 0);
            BufferedImage img;
            try {
                img = reader.read(0, param);
            } catch (Exception ex) {
                reader.dispose();
                throw new IOException("sketch decode failed", ex);
            }
            int sw = img.getWidth();
            int sh = img.getHeight();
            int[][] e = new int[3][sw * sh];
            int[] rgb = new int[sw];
            for (int y = 0; y < sh; y++) {
                img.getRGB(0, y, sw, 1, rgb, 0, sw);
                for (int c = 0; c < 3; c++) {
                    for (int x = 0; x < sw; x++) {
                        int p = rgb[x];
                        int[] v = YCoCgR.forward((p >> 16) & 0xFF, (p >> 8) & 0xFF, p & 0xFF);
                        e[c][y * sw + x] = v[c];
                    }
                }
            }
            reader.dispose();
            int stratum = Math.max(0, top - 3);
            while (stratum < top) {
                if (sw % 2 != 0) {
                    e = padWidth(e, sw, sh, sw + 1);
                    sw++;
                }
                if (sh % 2 != 0) {
                    e = padHeight(e, sw, sh);
                    sh++;
                }
                int[][] sig = means(e, sw, sh);
                if (stratum >= top - 3) {
                    paintLevel(sig, sw / 2, sh / 2, stratum, store);
                }
                e = sig;
                sw /= 2;
                sh /= 2;
                stratum++;
            }
            java.nio.file.Files.write(store.dir().resolve("semilla.bin"),
                    SeedCodec.encode(e, sw, sh));
        }
    }

    private static int[][] means(int[][] e, int w, int h) {
        int[][] out = new int[3][(w / 2) * (h / 2)];
        for (int c = 0; c < 3; c++) {
            int n = (w / 2) * (h / 2);
            TransformS.blockForward(e[c], w, h, out[c], new int[n], new int[n], new int[n]);
        }
        return out;
    }

    private static void paintLevel(int[][] padres, int w, int h, int stratum,
            FileBrushStore store) throws Exception {
        int nx = (w + 127) / 128;
        int ny = (h + 127) / 128;
        int[][][] cero = new int[3][1][16384];
        for (int by = 0; by < ny; by++) {
            for (int bx = 0; bx < nx; bx++) {
                int[][] pw = new int[3][16384];
                for (int c = 0; c < 3; c++) {
                    for (int y = 0; y < 128; y++) {
                        for (int x = 0; x < 128; x++) {
                            int sx = Math.min(bx * 128 + x, w - 1);
                            int sy = Math.min(by * 128 + y, h - 1);
                            pw[c][y * 128 + x] = padres[c][sy * w + sx];
                        }
                    }
                }
                var bb = BrushEncoder.encode(pw, cero, cero, cero, 16384, 128,
                        Quant.qy(stratum), Quant.qc(stratum));
                store.append(stratum, bx, by, bb.bands(), bb.crcs());
            }
        }
    }

    private static int[][] padWidth(int[][] e, int w, int h, int nw) {
        int[][] out = new int[3][nw * h];
        for (int c = 0; c < 3; c++) {
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < nw; x++) {
                    out[c][y * nw + x] = e[c][y * w + Math.min(x, w - 1)];
                }
            }
        }
        return out;
    }

    private static int[][] padHeight(int[][] e, int w, int h) {
        int[][] out = new int[3][w * (h + 1)];
        for (int c = 0; c < 3; c++) {
            System.arraycopy(e[c], 0, out[c], 0, w * h);
            System.arraycopy(e[c], w * (h - 1), out[c], w * h, w);
        }
        return out;
    }

}
