package seurat.net;

import java.io.IOException;
import java.io.OutputStream;
import seurat.session.Delivery;
import seurat.session.Canvas;

/**
 * WebTransport mapping (pending Hito 0 interop, Anexo B). Same semantics:
 * first bidi = control, uni per delivery, datagram MIRADA. Currently refuses
 * so every client deterministically takes the complete WS mapping.
 */
public final class WtMapping implements Mapping {
    @Override
    public OutputStream openDelivery(Canvas canvas, Delivery e) throws IOException {
        throw new IOException("webtransport no disponible (Hito 0 pendiente)");
    }

    @Override
    public void sendControl(byte[] trama) throws IOException {
        throw new IOException("webtransport no disponible (Hito 0 pendiente)");
    }

    @Override
    public void cancel(long delivery) {
    }

    @Override
    public void close() throws IOException {
    }
}
