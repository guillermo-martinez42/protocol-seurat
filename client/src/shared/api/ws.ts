import { MIRADA_MAX_PER_SEC } from '../config/constants';
import type { CloseHandler, ControlHandler, DeliveryHandler, SeuratTransport } from './transport';

const CANAL_CONTROL = 0;
const CANAL_DELIVERY = 1;
const CANAL_MIRADA = 2;

export class WsTransport implements SeuratTransport {
  readonly name = 'websocket' as const;
  readonly datagramas = false;
  onControl: ControlHandler | null = null;
  onDelivery: DeliveryHandler | null = null;
  onClose: CloseHandler | null = null;
  private ws: WebSocket | null = null;
  private miradaTimes: number[] = [];

  constructor(
    private url: string,
    private protocol = 'seurat.1',
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, this.protocol);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => reject(new Error('ws: connect failed'));
      ws.onclose = (ev) => this.onClose?.('ws close ' + ev.code);
      ws.onmessage = (ev) => this.route(ev.data as ArrayBuffer);
    });
  }

  private route(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    if (bytes.length < 1) return;
    const canal = bytes[0];
    const rest = bytes.slice(1);
    if (canal === CANAL_CONTROL) this.onControl?.(rest);
    else if (canal === CANAL_DELIVERY) this.onDelivery?.(rest);
  }

  sendControl(frame: Uint8Array): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 256 * 1024) return;
    const out = new Uint8Array(frame.length + 1);
    out[0] = CANAL_CONTROL;
    out.set(frame, 1);
    ws.send(out);
  }

  sendMiradaDatagram(payload: Uint8Array): void {
    const now = performance.now();
    this.miradaTimes = this.miradaTimes.filter((t) => now - t < 1000);
    if (this.miradaTimes.length >= MIRADA_MAX_PER_SEC) return;
    this.miradaTimes.push(now);
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const out = new Uint8Array(payload.length + 1);
    out[0] = CANAL_MIRADA;
    out.set(payload, 1);
    ws.send(out);
  }

  close(): void {
    this.ws?.close(1000, 'adios');
    this.ws = null;
  }
}
