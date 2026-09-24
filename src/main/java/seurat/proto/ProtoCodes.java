package seurat.proto;

/** Shared numeric codes: caps, events, states, motives, predicates, errors. */
public final class ProtoCodes {
    private ProtoCodes() {}

    public static final int CAP_DATAGRAMAS = 0x01;
    public static final int CAP_REANUDAR = 0x02;

    public static final int OBRA_LISTADO = 0;
    public static final int OBRA_ALTA = 1;
    public static final int OBRA_ESTADO = 2;
    public static final int OBRA_EDICION = 3;
    public static final int OBRA_BAJA = 4;

    public static final int ST_RECIBIENDO = 0;
    public static final int ST_BOCETO = 1;
    public static final int ST_PINTANDO = 2;
    public static final int ST_LISTA = 3;
    public static final int ST_FALLIDA = 4;
    public static final int ST_RETIRADA = 5;

    public static final int MOT_INICIAL = 0;
    public static final int MOT_MIRADA = 1;
    public static final int MOT_POLITICA = 2;
    public static final int MOT_OCULTA = 3;
    public static final int MOT_INACTIVIDAD = 4;
    public static final int MOT_ROL = 5;

    public static final int PLAN_INICIO = 0;
    public static final int PLAN_FIN = 1;
    public static final int PLAN_CANCELADAS = 2;

    public static final int REG_CARGA = 1;
    public static final int REG_PRESUPUESTO = 2;
    public static final int REG_COLA = 4;

    public static final int PRED_ESTRATO_BAJO = 1;
    public static final int PRED_FUERA = 2;
    public static final int PRED_BANDAS = 3;
    public static final int PRED_LISTA = 4;
    public static final int PRED_TODO = 5;

    public static final int SOLTAR_LRU = 1;
    public static final int SOLTAR_DECODIFICACION = 2;
    public static final int SOLTAR_CADUCADA = 3;
    public static final int SOLTAR_PRESUPUESTO = 4;
    public static final int SOLTAR_CONTEXTO_GPU = 5;
    public static final int SOLTAR_CRC = 6;
    public static final int SOLTAR_REEMPLAZADA = 7;

    public static final int ERR_PROTOCOLO = 1;
    public static final int ERR_VERSION = 2;
    public static final int ERR_AUTENTICACION = 3;
    public static final int ERR_OBRA_INEXISTENTE = 4;
    public static final int ERR_OBRA_NO_LISTA = 5;
    public static final int ERR_HANDLE = 6;
    public static final int ERR_POSESION = 7;
    public static final int ERR_LIQUIDACION = 8;
    public static final int ERR_TASA = 9;
    public static final int ERR_PRESUPUESTO = 10;
    public static final int ERR_INTERNO = 11;
    public static final int ERR_REANUDACION = 12;
}
