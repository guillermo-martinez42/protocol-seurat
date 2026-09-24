import { describe, expect, it } from 'vitest';
import { bandsFor, idealDensity, strataFor } from '@/entities/viewport/math';

describe('viewport density math (spec 2.2)', () => {
  it('spec 3.4.2 view gives ideal 1, s 1, phi 0, 4 bands', () => {
    const ideal = idealDensity({ x0: 65536, y0: 49152, x1: 69376, y1: 51312 }, { vw: 1920, vh: 1080 });
    expect(ideal).toBeCloseTo(1, 10);
    const { s, phi } = strataFor(ideal, 10);
    expect(s).toBe(1);
    expect(phi).toBeCloseTo(0, 10);
    expect(bandsFor(phi)).toBe(4);
  });
  it('bands follow phi quarters', () => {
    expect(bandsFor(0)).toBe(4);
    expect(bandsFor(0.3)).toBe(3);
    expect(bandsFor(0.6)).toBe(2);
    expect(bandsFor(0.9)).toBe(1);
  });
  it('ideal <= 0 pins to s 0', () => {
    expect(strataFor(-0.5, 10)).toEqual({ s: 0, phi: 0 });
    expect(strataFor(99, 10)).toEqual({ s: 10, phi: 0 });
  });
});
