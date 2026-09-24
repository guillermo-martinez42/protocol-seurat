import { postSesion } from '@/shared/api/http';
import type { SeuratTransport } from '@/shared/api/transport';
import { WsTransport } from '@/shared/api/ws';
import { WtTransport } from '@/shared/api/wt';
import { CLIENT_NAME } from '@/app/config';
import { CAP_DATAGRAMAS, CAP_REANUDAR, T } from '@/shared/proto/messages';
import {
  abrirCore,
  adiosCore,
  auditDecode,
  bienvenidaDecode,
  concesionDecode,
  errorDecode,
  latidoCore,
  gazeCore,
  gazeDecode,
  obraDecode,
  abiertaDecode,
  planDecode,
  scrapeDecode,
  renewDecode,
  saludoCore,
  saludoTlvs,
  receiptCore,
  scrapedCore,
  releaseCore,
  inventoryCore,
  type Abierta,
  type Audit,
  type Bienvenida,
  type Concession,
  type WorkMsg,
  type PlanMsg,
  type ProtoError,
  type Scrape,
  type Renew,
} from '@/shared/proto/messages';
import { concat, u64Decode, viEncode } from '@/shared/proto/varint';
import { encodeFrame, FatalProtocolError } from '@/shared/proto/frame';
import { splitFrame } from '@/shared/proto/frame';
import { declareMemMib, loadResume, persistResume } from '@/entities/session/store';

export interface SessionEvents {
  onBienvenida(b: Bienvenida): void;
  onObra(m: WorkMsg): void;
  onAbierta(a: Abierta): void;
  onConcesion(c: Concession): void;
  onPlan(p: PlanMsg): void;
  onRaspar(r: Scrape): void;
  onRenovar(r: Renew): void;
  onAuditar(a: Audit): void;
  onProtoError(e: ProtoError): void;
  onPreviewAbierta?(id: string, a: Abierta): void;
  onPreviewError?(id: string, e: ProtoError): void;
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
  private pendingOpens: Array<{ id: string; preview: boolean }> = [];

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
      ? { sesionAnterior: resume.sessionId, ticket: resume.ticket, claims: [] as Array<{ handle: number; ranges: number[] }> }
      : undefined;
    const s = { verMin: 1, verMax: 1, caps: CAP_DATAGRAMAS | CAP_REANUDAR, memMib: this.memMib, token, resume: claim };
    t.sendControl(encodeFrame(T.SALUDO, saludoCore(s), saludoTlvs(s)));
    this.events.onStatus('saludo');
  }

  private async connect(url: string, fallbackUrl: string): Promise<SeuratTransport> {
    if (WtTransport.supported()) {
      const wt = new WtTransport(url);
      try {
        await wt.connect();
        this.wire(wt);
        this.events.onStatus('webtransport');
        return wt;
      } catch {
        wt.close();
      }
    }
    const ws = new WsTransport(fallbackUrl);
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
          if (b.ticket.length === 32 && b.sessionId !== null) persistResume(b.sessionId, b.ticket);
          this.events.onBienvenida(b);
          break;
        }
        case T.LATIDO:
          this.transport?.sendControl(encodeFrame(T.ECO, latidoCore(u64Nonce(payload))));
          break;
        case T.ERROR: {
          const err = errorDecode(payload);
          const req = this.pendingOpens.length > 0 && err.refTipo === T.ABRIR ? this.pendingOpens.shift() : undefined;
          if (req?.preview) {
            this.events.onPreviewError?.(req.id, err);
          } else {
            this.events.onProtoError(err);
          }
          break;
        }
        case T.OBRA:
          this.events.onObra(obraDecode(payload));
          break;
        case T.ABIERTA: {
          const a = abiertaDecode(payload);
          const req = this.pendingOpens.shift();
          if (req?.preview) {
            this.events.onPreviewAbierta?.(req.id, a);
          } else {
            this.events.onAbierta(a);
          }
          break;
        }
        case T.MIRADA:
          this.events.onStatus('gaze-echo');
          gazeDecode(payload);
          break;
        case T.CONCESION:
          this.events.onConcesion(concesionDecode(payload));
          break;
        case T.PLAN:
          this.events.onPlan(planDecode(payload));
          break;
        case T.RASPAR:
          this.events.onRaspar(scrapeDecode(payload));
          break;
        case T.RENOVAR:
          this.events.onRenovar(renewDecode(payload));
          break;
        case T.AUDITAR:
          this.events.onAuditar(auditDecode(payload));
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
    this.pendingOpens.push({ id, preview: false });
    this.transport?.sendControl(encodeFrame(T.ABRIR, abrirCore(id)));
  }

  openPreview(id: string): void {
    this.pendingOpens.push({ id, preview: true });
    this.transport?.sendControl(encodeFrame(T.ABRIR, abrirCore(id)));
  }

  closeHandle(handle: number): void {
    this.transport?.sendControl(encodeFrame(T.CERRAR, concat(viEncode(handle))));
  }

  sendMiradaReliable(m: { handle: number; seq: number; x0: number; y0: number; x1: number; y1: number; vw: number; vh: number; mflags: number }): void {
    this.transport?.sendControl(encodeFrame(T.MIRADA, gazeCore(m)));
  }

  sendRecibo(handle: number, completed: number[], queueMs: number, libre: number, renewThrough: number): void {
    this.transport?.sendControl(encodeFrame(T.RECIBO, receiptCore({ handle, completed, queueMs, libre, renewThrough })));
  }

  sendSoltar(handle: number, reason: number, ranges: number[]): void {
    if (ranges.length === 0) return;
    this.transport?.sendControl(encodeFrame(T.SOLTAR, releaseCore({ handle, reason, ranges })));
  }

  sendRaspado(handle: number, order: number, epoch: number, through: number, raspadas: number, liberadasKib: number, conservadas: number[]): void {
    this.transport?.sendControl(
      encodeFrame(T.RASPADO, scrapedCore({ handle, order, epoch, through, raspadas, liberadasKib, conservadas })),
    );
  }

  sendInventory(handle: number, order: number, through: number, brushCount: number, kib: number, ranges: number[]): void {
    this.transport?.sendControl(
      encodeFrame(T.INVENTARIO, inventoryCore({ handle, order, through, brushCount, kib, ranges })),
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
