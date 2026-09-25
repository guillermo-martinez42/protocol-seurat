package seurat.ingest;

import java.awt.image.BufferedImage;
import java.io.BufferedInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.zip.InflaterInputStream;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;

/**
 * Sequential streaming PNG reader (O(1) memory, zero rewind) with ImageIO fallback
 * for non-standard/interlaced PNG or other formats.
 */
public final class PngReader implements MasterReader {
    private final int width;
    private final int height;
    private final int bpp;
    private final int colorType;
    private final boolean streaming;
    private final DataInputStream scanlines;
    private final java.util.zip.Inflater inf;
    private final InputStream rawStream;
    private final ImageReader fallbackReader;
    private final ImageInputStream fallbackInput;
    private byte[] curRow;
    private byte[] prevRow;
    private int row;

    public PngReader(Path source) throws IOException {
        StreamHeader hdr = tryStream(source);
        if (hdr != null) {
            this.streaming = true;
            this.width = hdr.w;
            this.height = hdr.h;
            this.bpp = hdr.bp;
            this.colorType = hdr.ct;
            this.rawStream = hdr.is;
            this.scanlines = hdr.sl;
            this.inf = hdr.inf;
            this.curRow = new byte[hdr.w * hdr.bp];
            this.prevRow = new byte[hdr.w * hdr.bp];
            this.fallbackReader = null;
            this.fallbackInput = null;
        } else {
            this.streaming = false;
            this.rawStream = null;
            this.scanlines = null;
            this.inf = null;
            this.bpp = 0;
            this.colorType = 0;
            this.fallbackInput = ImageIO.createImageInputStream(source.toFile());
            Iterator<ImageReader> it = ImageIO.getImageReaders(fallbackInput);
            if (!it.hasNext()) throw new IOException("unsupported format: " + source);
            this.fallbackReader = it.next();
            this.fallbackReader.setInput(fallbackInput);
            this.width = fallbackReader.getWidth(0);
            this.height = fallbackReader.getHeight(0);
        }
    }

    private record StreamHeader(int w, int h, int bp, int ct, InputStream is,
            DataInputStream sl, java.util.zip.Inflater inf) {}

    private static StreamHeader tryStream(Path source) {
        try {
            InputStream is = new BufferedInputStream(Files.newInputStream(source), 65536);
            DataInputStream dis = new DataInputStream(is);
            byte[] sig = new byte[8];
            dis.readFully(sig);
            if (!isPng(sig) || dis.readInt() < 13 || dis.readInt() != 0x49484452) {
                is.close();
                return null;
            }
            int w = dis.readInt(), h = dis.readInt();
            int depth = dis.readByte(), ct = dis.readByte();
            dis.readByte(); dis.readByte();
            int interlace = dis.readByte(); dis.readInt();
            if (depth != 8 || (ct != 0 && ct != 2 && ct != 6) || interlace != 0) {
                is.close();
                return null;
            }
            int bp = ct == 6 ? 4 : (ct == 2 ? 3 : 1);
            var inf = new java.util.zip.Inflater();
            DataInputStream sl = new DataInputStream(new InflaterInputStream(new IdatInputStream(dis), inf, 65536));
            return new StreamHeader(w, h, bp, ct, is, sl, inf);
        } catch (Exception ex) {
            return null;
        }
    }

    private static boolean isPng(byte[] s) {
        return (s[0] & 0xFF) == 0x89 && s[1] == 0x50 && s[2] == 0x4E && s[3] == 0x47
                && s[4] == 0x0D && s[5] == 0x0A && s[6] == 0x1A && s[7] == 0x0A;
    }

    @Override
    public int width() { return width; }

    @Override
    public int height() { return height; }

    private int[][] bandBuffer;

    @Override
    public int[][] next() throws IOException {
        if (row >= height) return null;
        int n = Math.min(256, height - row);
        if (bandBuffer == null) {
            bandBuffer = new int[256][width];
        }
        int[][] band = (n == 256) ? bandBuffer : java.util.Arrays.copyOf(bandBuffer, n);
        if (streaming) {
            int rowBytes = width * bpp;
            for (int y = 0; y < n; y++) {
                int filter = scanlines.readUnsignedByte();
                scanlines.readFully(curRow);
                PngUnfilter.unfilter(filter, curRow, prevRow, bpp, rowBytes);
                PngUnfilter.decodeRgb(curRow, band[y], colorType, width);
                byte[] tmp = prevRow; prevRow = curRow; curRow = tmp;
            }
        } else {
            var param = fallbackReader.getDefaultReadParam();
            param.setSourceRegion(new java.awt.Rectangle(0, row, width, n));
            BufferedImage img = fallbackReader.read(0, param);
            for (int y = 0; y < n; y++) img.getRGB(0, y, width, 1, band[y], 0, width);
        }
        row += n;
        return band;
    }

    @Override
    public double fraction() { return (double) row / Math.max(1, height); }

    @Override
    public void close() throws IOException {
        if (scanlines != null) scanlines.close();
        if (inf != null) inf.end();
        if (rawStream != null) rawStream.close();
        if (fallbackReader != null) fallbackReader.dispose();
        if (fallbackInput != null) fallbackInput.close();
    }
}
