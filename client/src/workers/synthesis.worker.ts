import type { SynthRequest, SynthResult } from './protocol';

function uleb(bytes: Uint8Array, pos: number): { v: number; n: number } {
  let v = 0;
  let sh = 0;
  let i = pos;
  for (;;) {
    const b = bytes[i];
    if (b === undefined) throw new Error('uleb truncated');
    v += (b & 0x7f) * 2 ** sh;
    i++;
    if ((b & 0x80) === 0) break;
    sh += 7;
  }
  return { v, n: i };
}

function zz(n: number): number {
  return (n & 1) === 0 ? n / 2 : -((n + 1) / 2);
}

function deq(i: number, q: number): number {
  if (i === 0 || q <= 0) return 0;
  const s = i > 0 ? 1 : -1;
  return s * (Math.abs(i) * q + Math.floor(q / 2));
}

function invBlock(s: number, h: number, v: number, d: number): [number, number, number, number] {
  const l1 = s + ((v + 1) >> 1);
  const l2 = l1 - v;
  const h1 = h + ((d + 1) >> 1);
  const h2 = h1 - d;
  const a = l1 + ((h1 + 1) >> 1);
  const b = a - h1;
  const c = l2 + ((h2 + 1) >> 1);
  return [a, b, c, c - h2];
}

function ycocgInv(y: number, co: number, cg: number): [number, number, number] {
  const t = y - (cg >> 1);
  const g = cg + t;
  const b = t - (co >> 1);
  return [b + co, g, b];
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  const p = new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let n = 0;
    const r = ds.readable.getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await r.read();
          if (done) break;
          chunks.push(value);
          n += value.length;
        }
        const out = new Uint8Array(n);
        let o = 0;
        for (const c of chunks) {
          out.set(c, o);
          o += c.length;
        }
        resolve(out);
      } catch (e) {
        reject(e);
      }
    })();
  });
  await w.write(data as unknown as Uint8Array<ArrayBuffer>);
  await w.close();
  return p;
}

self.onmessage = async (ev: MessageEvent<SynthRequest>) => {
  const t0 = performance.now();
  const req = ev.data;
  try {
    const w = req.seed ? req.semillaAncho : 256;
    const h = req.seed ? req.semillaAlto : 256;
    const px = w * h;
    const planes: Record<'Y' | 'Co' | 'Cg', Int16Array> = {
      Y: new Int16Array(px),
      Co: new Int16Array(px),
      Cg: new Int16Array(px),
    };

    if (req.seed) {
      const raw = await inflateRaw(new Uint8Array(req.bands[0] ?? new ArrayBuffer(0)));
      let p = 0;
      for (const ch of ['Y', 'Co', 'Cg'] as const) {
        const pl = planes[ch];
        for (let y = 0; y < h; y++) {
          let left = 0;
          for (let x = 0; x < w; x++) {
            const r = uleb(raw, p);
            p = r.n;
            left += zz(r.v);
            pl[y * w + x] = left;
          }
        }
      }
    } else {
      const n = 16384;
      const nch = req.qC > 0 ? 3 : 1;
      const chNames = ['Y', 'Co', 'Cg'] as const;
      const details: number[][][] = [
        [new Array(n).fill(0), new Array(n).fill(0), new Array(n).fill(0)],
        [new Array(n).fill(0), new Array(n).fill(0), new Array(n).fill(0)],
        [new Array(n).fill(0), new Array(n).fill(0), new Array(n).fill(0)],
      ];

      for (let b = 0; b < req.bands.length; b++) {
        const bandBytes = req.bands[b];
        if (!bandBytes || bandBytes.byteLength === 0) continue;
        const raw = await inflateRaw(new Uint8Array(bandBytes));
        let p = 0;
        const mask = new Uint8Array(n);
        for (let i = 0; i < n; i += 8) {
          const by = raw[p++] ?? 0;
          for (let k = 0; k < 8 && i + k < n; k++) mask[i + k] = (by >> k) & 1;
        }
        for (let c = 0; c < nch; c++) {
          const qq = c === 0 ? req.qY : req.qC;
          for (let det = 0; det < 3; det++) {
            const cur = details[c]?.[det];
            if (!cur) continue;
            for (let i = 0; i < n; i++) {
              if (mask[i] === 1) {
                const r = uleb(raw, p);
                p = r.n;
                cur[i] = deq(zz(r.v), qq);
              }
            }
          }
        }
      }

      for (let c = 0; c < nch; c++) {
        const chName = chNames[c];
        if (!chName) continue;
        const pl = planes[chName];
        const hVals = details[c]?.[0];
        const vVals = details[c]?.[1];
        const dVals = details[c]?.[2];
        for (let py = 0; py < 128; py++) {
          for (let pxCoord = 0; pxCoord < 128; pxCoord++) {
            const idx = py * 128 + pxCoord;
            const hVal = hVals?.[idx] ?? 0;
            const vVal = vVals?.[idx] ?? 0;
            const dVal = dVals?.[idx] ?? 0;
            const [a, b, cc, dd] = invBlock(0, hVal, vVal, dVal);
            pl[(2 * py) * 256 + 2 * pxCoord] = a;
            pl[(2 * py) * 256 + 2 * pxCoord + 1] = b;
            pl[(2 * py + 1) * 256 + 2 * pxCoord] = cc;
            pl[(2 * py + 1) * 256 + 2 * pxCoord + 1] = dd;
          }
        }
      }
    }

    const rgba = new Uint8ClampedArray(px * 4);
    for (let i = 0; i < px; i++) {
      const y = planes.Y[i] ?? 0;
      const co = planes.Co[i] ?? 0;
      const cg = planes.Cg[i] ?? 0;
      const [r, g, b] = ycocgInv(y, co, cg);
      rgba[i * 4] = Math.max(0, Math.min(255, r));
      rgba[i * 4 + 1] = Math.max(0, Math.min(255, g));
      rgba[i * 4 + 2] = Math.max(0, Math.min(255, b));
      rgba[i * 4 + 3] = 255;
    }

    const out: SynthResult = {
      delivery: req.delivery,
      ok: true,
      rgba: rgba.buffer as ArrayBuffer,
      width: w,
      height: h,
      elapsedMs: performance.now() - t0,
    };
    self.postMessage(out, { transfer: [out.rgba as ArrayBuffer] });
  } catch (e) {
    const out: SynthResult = {
      delivery: req.delivery,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      rgba: null,
      width: 0,
      height: 0,
      elapsedMs: performance.now() - t0,
    };
    self.postMessage(out);
  }
};
