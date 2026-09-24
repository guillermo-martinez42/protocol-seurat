package seurat.net;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import seurat.session.Canvas;
import seurat.session.Delivery;

/** Mapping that records control frames and delivery bytes for tests. */
public final class RecordingMapping implements Mapping {
    public final List<byte[]> control = new ArrayList<>();
    public final List<byte[]> deliveries = new ArrayList<>();

    @Override
    public synchronized void sendControl(byte[] frame) {
        control.add(frame.clone());
    }

    @Override
    public OutputStream openDelivery(Canvas canvas, Delivery delivery) {
        return new ByteArrayOutputStream() {
            @Override
            public void close() {
                synchronized (RecordingMapping.this) {
                    deliveries.add(toByteArray());
                }
            }
        };
    }

    @Override
    public void cancel(long delivery) {
    }

    @Override
    public void close() {
    }
}
