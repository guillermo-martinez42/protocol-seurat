package seurat.proto;

/** Message type registry. Numbers are never reused. */
public final class FrameType {
    private FrameType() {}

    public static final long SALUDO = 0x01;
    public static final long BIENVENIDA = 0x02;
    public static final long LATIDO = 0x03;
    public static final long ECO = 0x04;
    public static final long ERROR = 0x05;
    public static final long ADIOS = 0x06;
    public static final long CATALOGO = 0x10;
    public static final long OBRA = 0x11;
    public static final long ABRIR = 0x12;
    public static final long ABIERTA = 0x13;
    public static final long CERRAR = 0x14;
    public static final long MIRADA = 0x20;
    public static final long CONCESION = 0x21;
    public static final long PLAN = 0x23;
    public static final long RASPAR = 0x24;
    public static final long RASPADO = 0x25;
    public static final long RECIBO = 0x26;
    public static final long SOLTAR = 0x27;
    public static final long RENOVAR = 0x28;
    public static final long AUDITAR = 0x2A;
    public static final long INVENTARIO = 0x2B;
}
