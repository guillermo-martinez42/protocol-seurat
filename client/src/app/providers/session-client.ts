import { postSesion } from '@/shared/api/http';
import type { SeuratTransport } from '@/shared/api/transport';
import { WsTransport } from '@/shared/api/ws';
import { WtTransport } from '@/shared/api/wt';
import { CLIENT_NAME } from '@/app/config';
import { CAP_DATAGRAMAS, CAP_REANUDAR, T } from '@/shared/proto/messages';
import {
  abrirCore,
  adiosCore,
  auditarDecode,
  bienvenidaDecode,
  concesionDecode,
  errorDecode,
  latidoCore,
  miradaCore,
  miradaDecode,
  obraDecode,
  abiertaDecode,
  planDecode,
  rasparDecode,
  renovarDecode,
  saludoCore,
  saludoTlvs,
  reciboCore,
  raspadoCore,
  soltarCore,
  inventarioCore,
  type Abierta,
  type Auditar,
  type Bienvenida,
  type Concesion,
  type ObraMsg,
  type PlanMsg,
  type ProtoError,
  type Raspar,
  type Renovar,
} from '@/shared/proto/messages';
import { concat, u64Decode, viEncode } from '@/shared/proto/varint';
import { encodeFrame, FatalProtocolError } from '@/shared/proto/frame';
import { splitFrame } from '@/shared/proto/frame';
import { declareMemMib, loadResume, persistResume } from '@/entities/session/store';

export interface SessionEvents {
  onBienvenida(b: Bienvenida): void;
  onObra(m: ObraMsg): void;
  onAbierta(a: Abierta): void;
  onConcesion(c: Concesion): void;
  onPlan(p: PlanMsg): void;
  onRaspar(r: Raspar): void;
  onRenovar(r: Renovar): void;
  onAuditar(a: Auditar): void;
  onProtoError(e: ProtoError): void;
  onDelivery(bytes: Uint8Array): void;
  onStatus(s: string): void;
}

function tokenFromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export class SessionClient {
  private transport: SeuratTransport | null = null;
  private bienvenida: Bienvenida | null = null;
  private memMib = declareMemMib();
  private disposed = false;

  constructor(private events: SessionEvents) {}

  get info(): Bienvenida | null {
    return this.bienvenida;
  }

  get activeTransport(): SeuratTransport | null {
    return this.transport;
  }

  async boot(): Promise<void> {
    const resume = loadResume();
    const ses = await postSesion(CLIENT_NAME, this.memMib, ['webtransport', 'websocket']);
    const token = tokenFromHex(ses.token);
    const t = await this.connect(ses.lienzo, ses.respaldo);
    this.transport = t;
    const claim = resume
      ? { sesionAnterior: resume.sesionId, ficha: resume.ficha, claims: [] as Array<{ handle: number; rangos: number[] }> }
      : undefined;
    const s = { verMin: 1, verMax: 1, caps: CAP_DATAGRAMAS | CAP_REANUDAR, memMib: this.memMib, token, reanudar: claim };
    t.sendControl(encodeFrame(T.SALUDO, saludoCore(s), saludoTlvs(s)));
    this.events.onStatus('saludo');
  }

  private async connect(lienzo: string, respaldo: string): Promise<SeuratTransport> {
    if (WtTransport.supported()) {
      const wt = new WtTransport(lienzo);
      try {
        await wt.connect();
        this.wire(wt);
        this.events.onStatus('webtransport');
        return wt;
      } catch {
        wt.close();
      }
    }
    const ws = new WsTransport(respaldo);
    await ws.connect();
    this.wire(ws);
    this.events.onStatus('websocket');
    return ws;
  }

  wire(t: SeuratTransport): void {
    this.transport = t;
    t.onControl = (frame) => this.routeControl(frame);
    t.onDelivery = (bytes) => this.events.onDelivery(bytes);
    t.onClose = (reason) => this.events.onStatus('closed ' + reason);
  }

  private routeControl(frame: Uint8Array): void {
    let parts: Array<{ tipo: number; payload: Uint8Array }>;
    try {
      parts = splitAll(frame);
    } catch (e) {
      this.events.onStatus('frame error: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    for (const { tipo, payload } of parts) this.dispatch(tipo, payload);
  }

  private dispatch(tipo: number, payload: Uint8Array): void {
    try {
      switch (tipo) {
        case T.BIENVENIDA: {
          const b = bienvenidaDecode(payload);
          this.bienvenida = b;
          if (b.ficha.length === 32 && b.sesionId !== null) persistResume(b.sesionId, b.ficha);
          this.events.onBienvenida(b);
          break;
        }
        case T.LATIDO:
          this.transport?.sendControl(encodeFrame(T.ECO, latidoCore(u64Nonce(payload))));
          break;
        case T.ERROR:
          this.events.onProtoError(errorDecode(payload));
          break;
        case T.OBRA:
          this.events.onObra(obraDecode(payload));
          break;
        case T.ABIERTA:
          this.events.onAbierta(abiertaDecode(payload));
          break;
        case T.MIRADA:
          this.events.onStatus('mirada-echo');
          miradaDecode(payload);
          break;
        case T.CONCESION:
          this.events.onConcesion(concesionDecode(payload));
          break;
        case T.PLAN:
          this.events.onPlan(planDecode(payload));
          break;
        case T.RASPAR:
          this.events.onRaspar(rasparDecode(payload));
          break;
        case T.RENOVAR:
          this.events.onRenovar(renovarDecode(payload));
          break;
        case T.AUDITAR:
          this.events.onAuditar(auditarDecode(payload));
          break;
        default:
          if (tipo < 0x40) throw new FatalProtocolError('ERROR 1: unknown mandatory type');
          break;
      }
    } catch (e) {
      this.events.onStatus('dispatch: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  requestCatalog(): void {
    this.transport?.sendControl(encodeFrame(T.CATALOGO, new Uint8Array(0)));
  }

  openObra(id: string): void {
    this.transport?.sendControl(encodeFrame(T.ABRIR, abrirCore(id)));
  }

  closeHandle(handle: number): void {
    this.transport?.sendControl(encodeFrame(T.CERRAR, concat(viEncode(handle))));
  }

  sendMiradaReliable(m: { handle: number; seq: number; x0: number; y0: number; x1: number; y1: number; vw: number; vh: number; mflags: number }): void {
    this.transport?.sendControl(encodeFrame(T.MIRADA, miradaCore(m)));
  }

  sendRecibo(handle: number, completadas: number[], colaMs: number, libre: number, renovHasta: number): void {
    this.transport?.sendControl(encodeFrame(T.RECIBO, reciboCore({ handle, completadas, colaMs, libre, renovHasta })));
  }

  sendSoltar(handle: number, motivo: number, rangos: number[]): void {
    if (rangos.length === 0) return;
    this.transport?.sendControl(encodeFrame(T.SOLTAR, soltarCore({ handle, motivo, rangos })));
  }

  sendRaspado(handle: number, orden: number, epoca: number, hasta: number, raspadas: number, liberadasKib: number, conservadas: number[]): void {
    this.transport?.sendControl(
      encodeFrame(T.RASPADO, raspadoCore({ handle, orden, epoca, hasta, raspadas, liberadasKib, conservadas })),
    );
  }

  sendInventario(handle: number, orden: number, hasta: number, pinceladas: number, kib: number, rangos: number[]): void {
    this.transport?.sendControl(
      encodeFrame(T.INVENTARIO, inventarioCore({ handle, orden, hasta, pinceladas, kib, rangos })),
    );
  }

  sendAdios(): void {
    try {
      this.transport?.sendControl(encodeFrame(T.ADIOS, adiosCore({ codigo: 0, msg: 'adios' })));
    } catch {
      /* closing */
    }
  }

  dispose(): void {
    this.disposed = true;
    this.transport?.close();
    this.transport = null;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

function u64Nonce(payload: Uint8Array): bigint {
  return u64Decode(payload, 0).value;
}

function splitAll(frame: Uint8Array): Array<{ tipo: number; payload: Uint8Array }> {
  const out: Array<{ tipo: number; payload: Uint8Array }> = [];
  let pos = 0;
  while (pos < frame.length) {
    const s = splitFrame(frame.slice(pos));
    out.push({ tipo: s.tipo, payload: s.payload });
    pos += s.total;
  }
  return out;
}
