package seurat.net;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.util.Arrays;
import java.util.concurrent.BlockingQueue;
import seurat.session.Delivery;
import seurat.session.Canvas;

/**
 * WebSocket mapping (complete). channel 0 = control, 1 = delivery, 2 = MIRADA.
 * MIRADA coalesced at 20/stratum; deliveries sent as single binary messages.
 */
public final class WsMapping implements Mapping {
    private final Socket socket;
    private final InputStream in;
    private final OutputStream out;
    private final BlockingQueue<byte[]> control;
    private volatile boolean closed;

    public WsMapping(Socket socket, BlockingQueue<byte[]> control) throws IOException {
        this.socket = socket;
        this.in = socket.getInputStream();
        this.out = socket.getOutputStream();
        this.control = control;
    }

    public void pump() {
        try {
            for (;;) {
                WsFraming.Msg m = WsFraming.read(in);
                if (m.opcode() == 0x8) {
                    break;
                }
                if (m.opcode() == 0x9) {
                    synchronized (out) {
                        WsFraming.write(out, 0xA, m.data());
                    }
                    continue;
                }
                if ((m.opcode() != 0x2 && m.opcode() != 0x0) || m.data().length == 0) {
                    continue;
                }
                int channel = m.data()[0] & 0xFF;
                if (channel == 0 || channel == 2) {
                    control.put(Arrays.copyOfRange(m.data(), 1, m.data().length));
                }
            }
        } catch (Exception ignored) {
        } finally {
            control.offer(new byte[0]);
        }
    }

    @Override
    public synchronized void sendControl(byte[] trama) throws IOException {
        byte[] msg = new byte[trama.length + 1];
        msg[0] = 0;
        System.arraycopy(trama, 0, msg, 1, trama.length);
        synchronized (out) {
            WsFraming.write(out, 0x2, msg);
        }
    }

    @Override
    public OutputStream openDelivery(Canvas canvas, Delivery e) {
        return new ByteArrayOutputStream() {
            private boolean enviado;

            @Override
            public void close() throws IOException {
                super.close();
                synchronized (this) {
                    if (enviado || closed) {
                        return;
                    }
                    enviado = true;
                }
                byte[] cuerpo = toByteArray();
                byte[] msg = new byte[cuerpo.length + 1];
                msg[0] = 1;
                System.arraycopy(cuerpo, 0, msg, 1, cuerpo.length);
                synchronized (out) {
                    WsFraming.write(out, 0x2, msg);
                }
            }
        };
    }

    @Override
    public void cancel(long delivery) {
    }

    @Override
    public void close() throws IOException {
        closed = true;
        socket.close();
    }
}
