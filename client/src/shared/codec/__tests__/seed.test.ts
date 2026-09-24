import { describe, expect, it } from 'vitest';
import { decodeSeed } from '../seed';
import { ulebEncode, zigzagEncode } from '../leb128';
import { rgbToYCoCg } from '../ycocgr';

async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  const readPromise = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLen += value.length;
    }
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  })();

  await writer.write(data as unknown as Uint8Array<ArrayBuffer>);
  await writer.close();
  return readPromise;
}

describe('Seed codec (Stratum 10)', () => {
  it('correctly decodes DPCM + zigzag + LEB128 + deflate-raw seed to RGBA', async () => {
    const w = 4;
    const h = 4;
    const rgbColors = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
    ];

    const Y: number[] = [];
    const Co: number[] = [];
    const Cg: number[] = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = rgbColors[(y * w + x) % rgbColors.length] ?? [0, 0, 0];
        const [r = 0, g = 0, b = 0] = color;
        const yco = rgbToYCoCg(r, g, b);
        Y.push(yco.y);
        Co.push(yco.co);
        Cg.push(yco.cg);
      }
    }

    const raw: number[] = [];
    for (const pl of [Y, Co, Cg]) {
      for (let y = 0; y < h; y++) {
        let left = 0;
        for (let x = 0; x < w; x++) {
          const v = pl[y * w + x]!;
          raw.push(...ulebEncode(zigzagEncode(v - left)));
          left = v;
        }
      }
    }

    const compressed = await compressDeflateRaw(new Uint8Array(raw));
    const result = await decodeSeed(compressed, w, h);

    expect(result.width).toBe(w);
    expect(result.height).toBe(h);
    expect(result.rgba.length).toBe(w * h * 4);

    // Verify first pixel (255, 0, 0)
    expect(result.rgba[0]).toBe(255);
    expect(result.rgba[1]).toBe(0);
    expect(result.rgba[2]).toBe(0);
    expect(result.rgba[3]).toBe(255);

    // Verify second pixel (0, 255, 0)
    expect(result.rgba[4]).toBe(0);
    expect(result.rgba[5]).toBe(255);
    expect(result.rgba[6]).toBe(0);
    expect(result.rgba[7]).toBe(255);
  });
});
