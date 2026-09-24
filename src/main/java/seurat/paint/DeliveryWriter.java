package seurat.paint;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.util.concurrent.Semaphore;
import java.util.zip.CRC32C;
import seurat.codec.BrushId;
import seurat.codec.Quant;
import seurat.config.SeuratConstants;
import seurat.observe.Log;
import seurat.observe.Metrics;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.Headers;
import seurat.proto.MsgGaze;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.Delivery;

/** Flow writer: header + band bytes + FIN, then PLAN FIN / CANCELADAS. */
final class DeliveryWriter {
    private final Metrics metrics;
    private final Semaphore globalSlots;
    private final InFlightDeliveries inFlight;

    DeliveryWriter(Metrics metrics, Semaphore globalSlots, InFlightDeliveries inFlight) {
        this.metrics = metrics;
        this.globalSlots = globalSlots;
        this.inFlight = inFlight;
    }

    void write(Canvas canvas, Delivery delivery) {
        var session = canvas.session();
        try {
            byte[][] bandBytes = delivery.brush().stratum() == SeuratConstants.SEED_STRATUM
                    ? seedBands(canvas)
                    : canvas.store().bands(delivery.brush(), delivery.from(),
                            delivery.through());
            long[] crcs = new long[bandBytes.length];
            long[] lengths = new long[bandBytes.length];
            CRC32C crc = new CRC32C();
            for (int i = 0; i < bandBytes.length; i++) {
                crc.reset();
                crc.update(bandBytes[i]);
                crcs[i] = crc.getValue();
                lengths[i] = bandBytes[i].length;
            }
            var head = new Headers.BrushHead(canvas.handle(), delivery.number(),
                    delivery.brush().id(), delivery.from(), delivery.through(),
                    delivery.epoch(), Quant.qy(delivery.brush().stratum()),
                    Quant.qc(delivery.brush().stratum()), canvas.meta().edition(),
                    crcs, lengths);
            try (OutputStream out = session.mapping().openDelivery(canvas, delivery)) {
                out.write(head.encode());
                for (byte[] band : bandBytes) {
                    out.write(band);
                }
            }
            metrics.deliveries.increment();
            metrics.bytes.add(delivery.bytes());
            Log.debug("paint", "Delivered brush " + delivery.brush().id() + " (#"
                    + delivery.number() + ") to session " + session.id() + " canvas "
                    + canvas.handle() + " (" + delivery.bytes() + " B)");
            synchronized (canvas) {
                if (canvas.book().contains(delivery.number()) && canvas.advancePlan()) {
                    var planEnd = new MsgGaze.Plan(canvas.handle(), canvas.gazeSeq(),
                            ProtoCodes.PLAN_FIN, 0, 0, 0, canvas.book().lastNumber(),
                            null);
                    session.mapping().sendControl(
                            new Frame(FrameType.PLAN, planEnd.encode()).encode());
                    Log.debug("paint", "Plan complete on canvas " + canvas.handle()
                            + " (session " + session.id() + ")");
                }
            }
        } catch (Exception ex) {
            Log.warn("paint", "Delivery failed on canvas " + canvas.handle()
                    + " delivery #" + delivery.number() + ": " + ex.getMessage());
            boolean wasInBook;
            synchronized (canvas) {
                wasInBook = canvas.book().contains(delivery.number());
                canvas.book().cancel(delivery.number());
            }
            if (wasInBook) {
                var cancel = new MsgGaze.Plan(canvas.handle(), canvas.gazeSeq(),
                        ProtoCodes.PLAN_CANCELADAS, 0, 0, 0, 0,
                        Ranges.of(delivery.number()));
                try {
                    session.mapping().sendControl(
                            new Frame(FrameType.PLAN, cancel.encode()).encode());
                } catch (Exception ignored) {
                }
            }
        } finally {
            inFlight.remove(canvas, delivery);
            session.releaseSlot();
            globalSlots.release();
        }
    }

    private byte[][] seedBands(Canvas canvas) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        canvas.store().copy(new BrushId(10, 0, 0), 0, 1, b);
        return new byte[][]{b.toByteArray()};
    }
}
