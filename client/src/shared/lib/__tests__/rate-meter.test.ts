import { describe, expect, it } from 'vitest';
import { RateMeter } from '@/shared/lib/rate-meter';

/** 64 KB/s (a 512 kbit/s link) for `ms`, one 6.4 KB message every 100 ms. */
function feed(m: RateMeter, from: number, ms: number): number {
  for (let t = from; t < from + ms; t += 100) m.record(6400, t);
  return from + ms;
}

describe('RateMeter', () => {
  it('reads the live rate and total of a steady link', () => {
    const m = new RateMeter();
    const end = feed(m, 10_000, 3000);
    expect(m.total).toBe(30 * 6400);
    expect(m.rate(end - 1)).toBeGreaterThan(55_000);
    expect(m.rate(end - 1)).toBeLessThan(70_000);
  });

  it('drops the live rate when idle but keeps the busy peak for 10 s', () => {
    const m = new RateMeter();
    const end = feed(m, 10_000, 3000);
    expect(m.rate(end + 5000)).toBe(0);
    expect(m.peak(end + 5000)).toBeGreaterThan(55_000);
    expect(m.peak(end + 12_000)).toBe(0);
  });

  it('keeps 60 per-second history samples, newest last', () => {
    const m = new RateMeter();
    const end = feed(m, 10_000, 3000);
    const h = m.history(end);
    expect(h).toHaveLength(60);
    expect(h[0]).toBe(0);
    expect(h[58]).toBeGreaterThan(50_000);
  });

  it('forgets everything after a gap longer than its history', () => {
    const m = new RateMeter();
    feed(m, 10_000, 1000);
    expect(m.history(200_000).every((v) => v === 0)).toBe(true);
  });
});
