import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MiradaSender } from '@/features/send-mirada';
import type { SeuratTransport } from '@/shared/api/transport';

function fakeTransport(datagramas: boolean) {
  const t = {
    datagramas,
    control: [] as Uint8Array[],
    datagrams: [] as Uint8Array[],
    sendControl(f: Uint8Array): void {
      this.control.push(f);
    },
    sendMiradaDatagram(p: Uint8Array): void {
      this.datagrams.push(p);
    },
  };
  return t;
}

const base = { handle: 1, x0: 0, y0: 0, x1: 100, y1: 100, vw: 200, vh: 200, mflags: 0 };

describe('send-mirada', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces motion to one datagram per frame, last wins', () => {
    const t = fakeTransport(true);
    const s = new MiradaSender(() => t as unknown as SeuratTransport);
    s.motion({ ...base, x1: 100 });
    s.motion({ ...base, x1: 200 });
    s.motion({ ...base, x1: 300 });
    expect(t.datagrams.length).toBe(0);
    vi.advanceTimersByTime(16);
    expect(t.datagrams.length).toBe(1);
    s.dispose();
  });

  it('sends reliable QUIETA copy after 300ms idle', () => {
    const t = fakeTransport(true);
    const s = new MiradaSender(() => t as unknown as SeuratTransport);
    s.motion(base);
    vi.advanceTimersByTime(16);
    expect(t.control.length).toBe(0);
    vi.advanceTimersByTime(300);
    expect(t.control.length).toBe(1);
    s.dispose();
  });

  it('OCULTA goes reliable on the control channel', () => {
    const t = fakeTransport(true);
    const s = new MiradaSender(() => t as unknown as SeuratTransport);
    s.oculta(1);
    expect(t.control.length).toBe(1);
    expect(t.datagrams.length).toBe(0);
    s.dispose();
  });
});
