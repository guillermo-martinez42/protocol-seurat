import { describe, expect, it } from 'vitest';
import { sLebDecode, sLebEncode, ulebDecode, ulebEncode, zigzagDecode, zigzagEncode } from '@/shared/codec/leb128';
import { crc32c } from '@/shared/codec/crc32c';
import { rgbToYCoCg, yCoCgToRgb } from '@/shared/codec/ycocgr';
import { dequant, forwardBlock, inverseBlock, quant, spPredictH, spPredictV } from '@/shared/codec/spInverse';

describe('leb128 + zigzag', () => {
  it('uleb round-trips incl. multi-byte', () => {
    for (const v of [0, 1, 127, 128, 300, 16384, 2 ** 32, 2 ** 53 - 1]) {
      const enc = Uint8Array.from(ulebEncode(v));
      expect(ulebDecode(enc, 0).value).toBe(v);
    }
  });
  it('zigzag pairs', () => {
    expect([zigzagEncode(0), zigzagEncode(-1), zigzagEncode(1), zigzagEncode(-2)]).toEqual([0, 1, 2, 3]);
    for (const x of [0, 1, -1, 255, -256, 1020, -1021]) expect(zigzagDecode(zigzagEncode(x))).toBe(x);
  });
  it('signed round-trip', () => {
    for (const x of [0, -1, 63, -64, 510, -510, 1020, -1020]) {
      const enc = Uint8Array.from(sLebEncode(x));
      expect(sLebDecode(enc, 0).value).toBe(x);
    }
  });
});

describe('crc32c', () => {
  it('matches Castagnoli check vector', () => {
    const v = new TextEncoder().encode('123456789');
    expect(crc32c(v)).toBe(0xe3069283);
  });
  it('empty input is zero', () => {
    expect(crc32c(new Uint8Array(0))).toBe(0);
  });
});

describe('ycocg-r', () => {
  it('round-trips extremes and ramps', () => {
    const pts: Array<[number, number, number]> = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [13, 200, 77]];
    for (let v = 0; v < 256; v += 17) {
      pts.push([v, 0, 0], [0, v, 0], [0, 0, v], [v, v, v]);
    }
    for (const [r, g, b] of pts) {
      const { y, co, cg } = rgbToYCoCg(r, g, b);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(255);
      expect(Math.abs(co)).toBeLessThanOrEqual(255);
      expect(Math.abs(cg)).toBeLessThanOrEqual(255);
      expect(yCoCgToRgb(y, co, cg)).toEqual({ r, g, b });
    }
  });
});

describe('s+inverse', () => {
  it('inverts the forward transform incl. extremes', () => {
    const blocks: Array<[number, number, number, number]> = [
      [0, 0, 0, 0], [255, 255, 255, 255], [-510, 510, -255, 255], [10, -20, 30, -40],
    ];
    for (const [a, b, c, d] of blocks) {
      const f = forwardBlock(a, b, c, d);
      expect(inverseBlock(f.s, f.h, f.v, f.dv)).toEqual({ a, b, c, d });
    }
  });
  it('prediction + quantize round-trip at q=1', () => {
    expect(spPredictH(10, 6)).toBe((10 - 6 + 2) >> 2);
    expect(spPredictV(10, 6)).toBe((10 - 6 + 2) >> 2);
    for (const x of [-1020, -5, 0, 7, 1020]) expect(dequant(quant(x, 1), 1)).toBe(x);
  });
});
