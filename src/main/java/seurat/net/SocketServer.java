package seurat.net;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import seurat.net.http.HttpSurface;

/**
 * One TCP port: plain HTTP routes plus the seurat.1 WebSocket mapping.
 * No state is created before a valid SALUDO.
 */
public final class SocketServer {
    private final int port;
    private final HttpSurface http;
    private final WsAcceptor acceptor;

    public interface WsAcceptor {
        void accept(WsMapping mapping, BlockingQueue<byte[]> control);
    }

    public SocketServer(int port, HttpSurface http, WsAcceptor acceptor) {
        this.port = port;
        this.http = http;
        this.acceptor = acceptor;
    }

    public void start() throws Exception {
        try (ServerSocket server = new ServerSocket(port)) {
            for (;;) {
                Socket socket = server.accept();
                Thread.ofVirtual().start(() -> {
                    try {
                        handle(socket);
                    } catch (Exception ignored) {
                        try {
                            socket.close();
                        } catch (Exception alsoIgnored) {
                        }
                    }
                });
            }
        }
    }

    private void handle(Socket socket) throws Exception {
        InputStream in = socket.getInputStream();
        OutputStream out = socket.getOutputStream();
        String head = readLine(in);
        if (head == null) {
            socket.close();
            return;
        }
        String[] parts = head.split(" ", 3);
        Map<String, String> headers = new HashMap<>();
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            int colon = line.indexOf(':');
            if (colon > 0) {
                headers.put(line.substring(0, colon).trim().toLowerCase(),
                        line.substring(colon + 1).trim());
            }
        }
        if (isWebSocket(parts, headers)) {
            upgrade(socket, headers.get("sec-websocket-key"));
            return;
        }
        int length = 0;
        try {
            length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
        } catch (NumberFormatException ex) {
            length = 0;
        }
        byte[] body = in.readNBytes(length);
        String host = headers.getOrDefault("host", "localhost:" + port);
        var response = http.route(new HttpSurface.Request(parts[0], parts[1], headers,
                body, host));
        String status = response.code() == 200 ? "200 OK"
                : response.code() == 201 ? "201 Created"
                : response.code() == 202 ? "202 Accepted"
                : response.code() == 403 ? "403 Forbidden" : "404 Not Found";
        if (response.code() == 500) {
            status = "500 Internal Error";
        }
        String header = "HTTP/1.1 " + status + "\r\nContent-Type: " + response.type()
                + "\r\nContent-Length: " + response.body().length
                + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.write(response.body());
        out.flush();
        socket.close();
    }

    private static boolean isWebSocket(String[] parts, Map<String, String> headers) {
        return parts.length == 3 && parts[0].equals("GET")
                && parts[1].equals("/seurat/v1/lienzo-ws")
                && headers.getOrDefault("upgrade", "").equalsIgnoreCase("websocket");
    }

    private void upgrade(Socket socket, String key) throws Exception {
        String accept = Base64.getEncoder().encodeToString(MessageDigest
                .getInstance("SHA-1").digest(
                        (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
                                .getBytes(StandardCharsets.UTF_8)));
        String response = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                + "Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept
                + "\r\nSec-WebSocket-Protocol: seurat.1\r\n\r\n";
        socket.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
        socket.getOutputStream().flush();
        BlockingQueue<byte[]> control = new LinkedBlockingQueue<>();
        acceptor.accept(new WsMapping(socket, control), control);
    }

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
