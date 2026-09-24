# lib/ — vendored dependencies (offline grade)

This server is **pure JDK 21**: HTTP + WebSocket run on `java.net` +
`java.security`, imaging on `javax.imageio`, compression on `java.util.zip`.
No third-party jar is needed to build or run, so `lib/` intentionally stays
empty. `javac`/`java` with no `-cp` reproduce the grade build exactly.

Future WebTransport mapping (Hito 0, spec Anexo B) will vendor its QUIC /
HTTP-3 jars here with artifact + version + license lines, and `run.sh` will
add `-cp 'lib/*'`. The WebSocket mapping is complete without them.
