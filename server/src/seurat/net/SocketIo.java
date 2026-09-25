package seurat.net;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Helper for reading line-based HTTP requests from stream. */
final class SocketIo {
    private SocketIo() {}

    static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int prev = -1;
        for (;;) {
            int b = in.read();
            if (b < 0) {
                return line.size() == 0 && prev != 1 ? null : line.toString(StandardCharsets.UTF_8);
            }
            if (b == '\n') {
                break;
            }
            if (prev == '\r') {
                line.write('\r');
            }
            if (b != '\r') {
                line.write(b);
            }
            prev = b;
        }
        return line.toString(StandardCharsets.UTF_8);
    }
}
