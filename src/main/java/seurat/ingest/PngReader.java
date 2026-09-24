package seurat.ingest;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Iterator;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

/** PNG/JPEG/TIFF via ImageIO, region reads so big masters stay bounded. */
public final class PngReader implements MasterReader {
    private final ImageReader reader;
    private final ImageInputStream entry;
    private final int width;
    private final int height;
    private int row;

    public PngReader(Path ruta) throws IOException {
        entry = ImageIO.createImageInputStream(ruta.toFile());
        Iterator<ImageReader> it = ImageIO.getImageReaders(entry);
        if (!it.hasNext()) {
            throw new IOException("unsupported format: " + ruta);
        }
        reader = it.next();
        reader.setInput(entry);
        width = reader.getWidth(0);
        height = reader.getHeight(0);
    }

    @Override
    public int width() {
        return width;
    }

    @Override
    public int height() {
        return height;
    }

    @Override
    public int[][] next() throws IOException {
        if (row >= height) {
            return null;
        }
        int n = Math.min(256, height - row);
        var param = reader.getDefaultReadParam();
        param.setSourceRegion(new java.awt.Rectangle(0, row, width, n));
        BufferedImage img = reader.read(0, param);
        int[][] band = new int[n][width];
        for (int y = 0; y < n; y++) {
            img.getRGB(0, y, width, 1, band[y], 0, width);
        }
        row += n;
        return band;
    }

    @Override
    public double fraction() {
        return (double) row / Math.max(1, height);
    }

    @Override
    public void close() throws IOException {
        reader.dispose();
        entry.close();
    }
}
