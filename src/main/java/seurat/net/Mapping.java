package seurat.net;

import java.io.IOException;
import java.io.OutputStream;
import seurat.session.Delivery;
import seurat.session.Canvas;

/** One semantic, two mappings. WS is complete; WT follows in Hito 0. */
public interface Mapping {
    /** Opens one delivery flow (WT: server uni stream; WS: channel-1 message). */
    OutputStream openDelivery(Canvas canvas, Delivery e) throws IOException;

    /** Sends one control frame (WT: client bidi; WS: channel 0). */
    void sendControl(byte[] trama) throws IOException;

    /** Cancels a delivery (WT: RESET_STREAM; WS: best effort pre-write). */
    void cancel(long delivery);

    void close() throws IOException;
}
