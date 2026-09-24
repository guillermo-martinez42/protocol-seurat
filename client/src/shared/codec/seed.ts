import { ulebDecode, zigzagDecode } from './leb128';
import { yCoCgToRgb } from './ycocgr';

export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
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

export async function decodeSeed(
  bandBytes: Uint8Array,
  width: number,
  height: number,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const raw = await inflateRaw(bandBytes);
  const px = width * height;
  const planes: Record<'Y' | 'Co' | 'Cg', Int16Array> = {
    Y: new Int16Array(px),
    Co: new Int16Array(px),
    Cg: new Int16Array(px),
  };

  let p = 0;
  for (const ch of ['Y', 'Co', 'Cg'] as const) {
    const pl = planes[ch];
    for (let y = 0; y < height; y++) {
      let left = 0;
      for (let x = 0; x < width; x++) {
        const r = ulebDecode(raw, p);
        p = r.next;
        left += zigzagDecode(r.value);
        pl[y * width + x] = left;
      }
    }
  }

  const rgba = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    const y = planes.Y[i] ?? 0;
    const co = planes.Co[i] ?? 0;
    const cg = planes.Cg[i] ?? 0;
    const { r, g, b } = yCoCgToRgb(y, co, cg);
    rgba[i * 4] = Math.max(0, Math.min(255, r));
    rgba[i * 4 + 1] = Math.max(0, Math.min(255, g));
    rgba[i * 4 + 2] = Math.max(0, Math.min(255, b));
    rgba[i * 4 + 3] = 255;
  }

  return { rgba, width, height };
}

export function drawScaledRgba(
  targetCtx: CanvasRenderingContext2D,
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): void {
  let off: OffscreenCanvas | HTMLCanvasElement | null = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    off = new OffscreenCanvas(srcW, srcH);
  } else if (typeof document !== 'undefined') {
    off = document.createElement('canvas');
    off.width = srcW;
    off.height = srcH;
  }
  if (!off) return;
  const octx = off.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!octx) return;
  octx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), srcW, srcH), 0, 0);
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = 'high';
  targetCtx.drawImage(off as CanvasImageSource, 0, 0, dstW, dstH);
}
