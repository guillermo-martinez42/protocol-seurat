import { hash3 } from '@/shared/lib/hash3';

export interface PointillismBrush {
  x: number;
  y: number;
  w: number;
  h: number;
  bmp: ImageBitmap;
}

export interface PointillismParams {
  tx: number;
  ty: number;
  s: number;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  iw: number;
  ih: number;
  f: number;
  brushes: PointillismBrush[];
  scratchCanvas: HTMLCanvasElement;
}

export function drawPointillism(
  ctx: CanvasRenderingContext2D,
  params: PointillismParams,
): void {
  const { tx, ty, s, cx0, cy0, cx1, cy1, iw, ih, f, brushes, scratchCanvas } = params;
  if (brushes.length === 0 || s <= 0) return;

  const x0 = Math.max(0, Math.floor((cx0 - tx) / s));
  const y0 = Math.max(0, Math.floor((cy0 - ty) / s));
  const x1 = Math.min(iw, Math.ceil((cx1 - tx) / s));
  const y1 = Math.min(ih, Math.ceil((cy1 - ty) / s));
  const sw = x1 - x0;
  const sh = y1 - y0;
  if (sw <= 0 || sh <= 0) return;

  scratchCanvas.width = sw;
  scratchCanvas.height = sh;
  const sctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  if (!sctx) return;
  sctx.imageSmoothingEnabled = false;
  sctx.clearRect(0, 0, sw, sh);

  for (const b of brushes) {
    if (b.x + b.w <= x0 || b.x >= x1 || b.y + b.h <= y0 || b.y >= y1) continue;
    sctx.drawImage(b.bmp, b.x - x0, b.y - y0, b.w, b.h);
  }

  const imgData = sctx.getImageData(0, 0, sw, sh);
  const data = imgData.data;
  const grow = 0.4 + 0.6 * f;
  const twoPi = Math.PI * 2;

  for (let gy = 0; gy < sh; gy++) {
    const iy = y0 + gy;
    const rowOffset = gy * sw * 4;
    for (let gx = 0; gx < sw; gx++) {
      const idx = rowOffset + gx * 4;
      const a = data[idx + 3] ?? 0;
      if (a === 0) continue;
      const r = data[idx] ?? 0;
      const g = data[idx + 1] ?? 0;
      const b = data[idx + 2] ?? 0;
      const ix = x0 + gx;

      const [h1, h2, h3] = hash3(ix, iy);
      let cx = tx + (ix + 0.5) * s;
      let cy = ty + (iy + 0.5) * s;
      cx += (h1 - 0.5) * s * 0.24;
      cy += (h2 - 0.5) * s * 0.24;
      const rad = s * (0.33 + 0.15 * h3) * grow;

      if (cx + rad < cx0 || cx - rad > cx1 || cy + rad < cy0 || cy - rad > cy1) continue;

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, twoPi);
      ctx.fill();
    }
  }
}

export function samplePixelHex(
  brushes: PointillismBrush[],
  ix: number,
  iy: number,
  scratch: HTMLCanvasElement,
): string | null {
  for (let i = brushes.length - 1; i >= 0; i--) {
    const b = brushes[i];
    if (!b) continue;
    if (ix >= b.x && ix < b.x + b.w && iy >= b.y && iy < b.y + b.h) {
      scratch.width = 1;
      scratch.height = 1;
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = false;
      const w = b.bmp.width ?? b.w;
      const h = b.bmp.height ?? b.h;
      const scaleX = w / b.w;
      const scaleY = h / b.h;
      const srcX = (ix - b.x) * scaleX;
      const srcY = (iy - b.y) * scaleY;
      ctx.drawImage(b.bmp, -srcX, -srcY);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      const r = data[0] ?? 0;
      const g = data[1] ?? 0;
      const bVal = data[2] ?? 0;
      return '#' + [r, g, bVal].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
  }
  return null;
}
