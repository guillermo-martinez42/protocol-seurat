package seurat.net;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.concession.GrantController;
import seurat.config.SeuratConfig;
import seurat.ingest.IngestJob;
import seurat.kit.TestKit;
import seurat.net.http.HttpSurface;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.Headers;
import seurat.proto.MsgCatalog;
import seurat.proto.MsgGaze;
import seurat.proto.MsgLoans;
import seurat.proto.Ranges;
import seurat.regulate.Regulator;
import seurat.session.Easel;
import seurat.session.Sessions;

/** Loopback: HTTP + WS handshake + SALUDO..sketch + RECIBO, no internet. */
public final class WsLoopbackTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("loopback-test");
        Path works = root.resolve("obras");
        Catalog catalog = new Catalog(works);
        Path master = TestKit.masterPng(root, "loop.png", 2048, 1536);
        boolean[] ready = {false};
        new IngestJob("loop", "Loop", master, works, catalog, () -> ready[0] = true).run();
        TestKit.check(ready[0], "ingest ready");

        Path conf = root.resolve("seurat.conf");
        Files.writeString(conf, "http.port=0\nadmin.token=t\n");
        SeuratConfig config = SeuratConfig.load(conf);
        Sessions sessions = new Sessions();
        Painter painter = new Painter(new Regulator(),
                new BrushBudget(root.resolve("cov")), new Metrics());
        GrantController grants = new GrantController(catalog, painter, sessions);
        Thread.ofPlatform().daemon().start(painter);
        Path web = root.resolve("web");
        Files.createDirectories(web);
        Files.writeString(web.resolve("index.html"), "x");
        HttpSurface http = new HttpSurface(web, sessions, catalog, config,
                (id, file) -> {}, id -> {}, id -> {});
        int port = freePort();
        var server = new SocketServer(port, http, (WsMapping mapping,
                BlockingQueue<byte[]> control) -> {
            Thread.ofVirtual().start(mapping::pump);
            Thread.ofVirtual().start(new Easel(mapping, control, sessions, catalog,
                    grants, painter, 1024));
        });
        Thread.ofPlatform().daemon().start(() -> {
            try {
                server.start();
            } catch (Exception ignored) {
            }
        });
        Thread.sleep(300);

        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(15000);
            String token = postSession(port);
            wsHandshake(socket);
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();
            sendWs(out, 0, hello(token));
            Frame welcome = readControl(in);
            TestKit.check(welcome.type() == FrameType.BIENVENIDA, "BIENVENIDA");
            sendWs(out, 0, new Frame(FrameType.CATALOGO, new byte[0]).encode());
            Frame work = readControl(in);
            TestKit.check(work.type() == FrameType.OBRA, "OBRA listing, got " + work.type());
            sendWs(out, 0, frame(FrameType.ABRIR, openWork("loop")));
            Frame opened = readControl(in);
            TestKit.check(opened.type() == FrameType.ABIERTA, "ABIERTA");
            var openedMeta = MsgCatalog.WorkOpened.parse(opened.payload());
            TestKit.check(openedMeta.width() == 2048 && openedMeta.edition() == 2,
                    "ABIERTA dims/edition");
            Frame concession = readControl(in);
            TestKit.check(concession.type() == FrameType.CONCESION, "CONCESION");
            Frame plan = readControl(in);
            TestKit.check(plan.type() == FrameType.PLAN, "PLAN INICIO");
            var inicio = MsgGaze.Plan.parse(plan.payload());
            TestKit.check(inicio.expectedCount() > 0, "sketch planned");
            var flows = readFlows(in, (int) inicio.expectedCount());
            TestKit.check(flows.deliveries.size() == inicio.expectedCount(),
                    "all sketch flows");
            Ranges.Builder done = new Ranges.Builder();
            for (long n : flows.deliveries) {
                done.add(n);
            }
            var receipt = new MsgLoans.Receipt(openedMeta.handle(), done.build(), 40,
                    700, 0);
            sendWs(out, 0, frame(FrameType.RECIBO, receipt.encode()));
            TestKit.check(flows.fin, "PLAN FIN interleaved");
            var gaze = new MsgGaze.Gaze(openedMeta.handle(), 1, 0, 0, 1024, 768, 1024, 768, 0);
            sendWs(out, 2, gaze.encode());
            Frame responseFrame = readControl(in);
            if (responseFrame.type() == FrameType.CONCESION) {
                responseFrame = readControl(in);
            }
            TestKit.check(responseFrame.type() == FrameType.PLAN, "PLAN response to channel 2 MIRADA");
        }
        System.out.println("WsLoopbackTest OK");
    }

    private static int freePort() throws Exception {
        try (ServerSocket probe = new ServerSocket(0)) {
            return probe.getLocalPort();
        }
    }

    private static byte[] openWork(String id) {
        java.nio.ByteBuffer b = java.nio.ByteBuffer.allocate(32);
        byte[] raw = id.getBytes(StandardCharsets.UTF_8);
        b.put((byte) raw.length);
        b.put(raw);
        byte[] out = new byte[b.position()];
        b.flip();
        b.get(out);
        return out;
    }

    private static byte[] hello(String tokenHex) {
        byte[] token = TestKit.unhex(tokenHex);
        java.nio.ByteBuffer b = java.nio.ByteBuffer.allocate(64);
        b.put((byte) 0x01);
        b.put((byte) 0x01);
        b.put((byte) 0x03);
        b.put((byte) 0x41);
        b.put((byte) 0x00);
        b.put((byte) 0x20);
        b.put(token);
        byte[] payload = new byte[b.position()];
        b.flip();
        b.get(payload);
        return new Frame(FrameType.SALUDO, payload).encode();
    }

    private static String postSession(int port) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            String body = "{\"memMiB\":128}";
            String req = "POST /seurat/v1/sesion HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer loopback\r\nContent-Length: "
                    + body.length() + "\r\nConnection: close\r\n\r\n" + body;
            socket.getOutputStream().write(req.getBytes(StandardCharsets.UTF_8));
            byte[] response = socket.getInputStream().readAllBytes();
            String text = new String(response, StandardCharsets.UTF_8);
            TestKit.check(text.contains("201"), "POST /sesion 201:\n" + text);
            return text.split("\"token\":\"")[1].split("\"")[0];
        }
    }

    private static void wsHandshake(Socket socket) throws Exception {
        byte[] keyBytes = new byte[16];
        new java.util.Random().nextBytes(keyBytes);
        String key = Base64.getEncoder().encodeToString(keyBytes);
        String req = "GET /seurat/v1/lienzo-ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n"
                + "Connection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\n"
                + "Sec-WebSocket-Version: 13\r\n\r\n";
        socket.getOutputStream().write(req.getBytes(StandardCharsets.UTF_8));
        StringBuilder head = new StringBuilder();
        int b;
        while (!(head.length() >= 4
                && head.substring(head.length() - 4).equals("\r\n\r\n"))) {
            b = socket.getInputStream().read();
            head.append((char) b);
        }
        TestKit.check(head.toString().contains("101"), "WS 101:\n" + head);
        String accept = Base64.getEncoder().encodeToString(MessageDigest
                .getInstance("SHA-1").digest(
                        (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
                                .getBytes(StandardCharsets.UTF_8)));
        TestKit.check(head.toString().contains(accept), "WS accept key");
    }

    private static byte[] frame(long type, byte[] payload) {
        return new Frame(type, payload).encode();
    }

    private static void sendWs(OutputStream out, int channel, byte[] frame) throws Exception {
        byte[] message = new byte[frame.length + 1];
        message[0] = (byte) channel;
        System.arraycopy(frame, 0, message, 1, frame.length);
        byte[] mask = {1, 2, 3, 4};
        for (int i = 0; i < message.length; i++) {
            message[i] ^= mask[i % 4];
        }
        java.io.ByteArrayOutputStream head = new java.io.ByteArrayOutputStream();
        head.write(0x82);
        if (message.length < 126) {
            head.write(0x80 | message.length);
        } else {
            head.write(0x80 | 126);
            head.write(message.length >> 8);
            head.write(message.length);
        }
        head.write(mask, 0, 4);
        synchronized (out) {
            out.write(head.toByteArray());
            out.write(message);
            out.flush();
        }
    }

    private static Frame readControl(InputStream in) throws Exception {
        for (;;) {
            WsFraming.Msg message = WsFraming.read(in);
            if (message.opcode() == 0x2 && message.data().length > 0
                    && message.data()[0] == 0) {
                byte[] frame = new byte[message.data().length - 1];
                System.arraycopy(message.data(), 1, frame, 0, frame.length);
                return Frame.decode(ByteBuffer.wrap(frame));
            }
        }
    }

    record Flows(List<Long> deliveries, boolean fin) {}

    private static Flows readFlows(InputStream in, int want) throws Exception {
        List<Long> numbers = new ArrayList<>();
        boolean fin = false;
        long deadline = System.currentTimeMillis() + 20000;
        while ((numbers.size() < want || !fin) && System.currentTimeMillis() < deadline) {
            WsFraming.Msg message = WsFraming.read(in);
            if (message.opcode() != 0x2 || message.data().length == 0) {
                continue;
            }
            if (message.data()[0] == 1) {
                byte[] flow = new byte[message.data().length - 1];
                System.arraycopy(message.data(), 1, flow, 0, flow.length);
                var head = Headers.BrushHead.parse(ByteBuffer.wrap(flow));
                numbers.add(head.delivery());
            } else if (message.data()[0] == 0) {
                byte[] frame = new byte[message.data().length - 1];
                System.arraycopy(message.data(), 1, frame, 0, frame.length);
                if (Frame.decode(ByteBuffer.wrap(frame)).type() == FrameType.PLAN) {
                    fin = true;
                }
            }
        }
        return new Flows(numbers, fin);
    }
}
