import { MIRADA_QUIETA_IDLE_MS } from '@/shared/config/constants';
import { miradaCore, T, type Mirada } from '@/shared/proto/messages';
import { concat, viEncode } from '@/shared/proto/varint';
import type { SeuratTransport } from '@/shared/api/transport';

export const MFLAGS_OCULTA = 0x01;
export const MFLAGS_QUIETA = 0x02;

export class MiradaSender {
  private seq = 0;
  private pending: Mirada | null = null;
  private last: Mirada | null = null;
  private raf = 0;
  private idleTimer = 0;
  private lastSentAt = 0;

  constructor(private transport: () => SeuratTransport | null) {}

  motion(m: Omit<Mirada, 'seq'>): void {
    this.seq += 1;
    this.pending = { ...m, seq: this.seq };
    this.last = this.pending;
    if (this.raf === 0) {
      const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number };
      if (typeof g.requestAnimationFrame === 'function') {
        this.raf = g.requestAnimationFrame(() => {
          this.raf = 0;
          this.flush(false);
        });
      } else {
        this.raf = 1;
        setTimeout(() => {
          this.raf = 0;
          this.flush(false);
        }, 16);
      }
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.flush(true), MIRADA_QUIETA_IDLE_MS) as unknown as number;
  }

  oculta(handle: number): void {
    this.seq += 1;
    const t = this.transport();
    if (!t) return;
    const core = miradaCore({ handle, seq: this.seq, x0: 0, y0: 0, x1: 0, y1: 0, vw: 0, vh: 0, mflags: MFLAGS_OCULTA });
    t.sendControl(concat(viEncode(T.MIRADA), viEncode(core.length), core));
    this.pending = null;
  }

  private flush(quieta: boolean): void {
    const t = this.transport();
    const m = this.pending ?? (quieta ? this.last : null);
    if (!t || !m) return;
    this.pending = null;
    this.lastSentAt = performance.now();
    if (quieta) {
      const core = miradaCore({ ...m, mflags: m.mflags | MFLAGS_QUIETA });
      t.sendControl(concat(viEncode(T.MIRADA), viEncode(core.length), core));
    } else {
      const core = miradaCore(m);
      if (t.datagramas) t.sendMiradaDatagram(concat(viEncode(T.MIRADA), core));
      else t.sendMiradaDatagram(core);
    }
  }

  get lastSent(): number {
    return this.lastSentAt;
  }

  dispose(): void {
    const g = globalThis as { cancelAnimationFrame?: (h: number) => void };
    if (typeof g.cancelAnimationFrame === 'function' && this.raf !== 0) g.cancelAnimationFrame(this.raf);
    clearTimeout(this.idleTimer);
    this.raf = 0;
    this.pending = null;
  }
}
