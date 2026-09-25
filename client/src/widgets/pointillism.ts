import { hash3 } from '@/shared/lib/hash3';
import { TAU, DOT_SPACING_PX, DOT_TILE_CELLS } from '@/shared/config/render';

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
  brushes: PointillismBrush[];
  scratchCanvas: HTMLCanvasElement;
}

/** Dots per image-pixel side: ~DOT_SPACING_PX apart on screen, never fewer than 2, so a pixel is always several dots. */
export function dotsPerSide(s: number): number {
  return Math.max(2, Math.round(s / DOT_SPACING_PX));
}

/**
 * One dot per cell of a DOT_TILE_CELLS² tile, in cell units. Jitter + radius stay under half a
 * cell, so a dot never leaves its cell, and cells tile each pixel exactly: no dot crosses a pixel edge.
 */
export function tileDots(): Array<{ x: number; y: number; r: number }> {
  const out: Array<{ x: number; y: number; r: number }> = [];
  for (let j = 0; j < DOT_TILE_CELLS; j++) {
    for (let i = 0; i < DOT_TILE_CELLS; i++) {
      const [h1, h2, h3] = hash3(i, j);
      const r = 0.3 + 0.1 * h3;
      const room = 0.8 * (0.5 - r);
      out.push({ x: i + 0.5 + (2 * h1 - 1) * room, y: j + 0.5 + (2 * h2 - 1) * room, r });
    }
  }
  return out;
}

/** Tile origin near 0 that keeps the cell grid on the pixel grid (huge images pan to tx ≈ -1e7). */
export function patternOrigin(t: number, period: number): number {
  return t - Math.floor(t / period) * period;
}

const CELL_PX = 16;
let tile: HTMLCanvasElement | null = null;

function dotTile(): HTMLCanvasElement {
  if (tile) return tile;
  const c = document.createElement('canvas');
  c.width = c.height = DOT_TILE_CELLS * CELL_PX;
  const t = c.getContext('2d');
  if (t) {
    t.fillStyle = '#fff';
    t.beginPath();
    for (const d of tileDots()) {
      t.moveTo((d.x + d.r) * CELL_PX, d.y * CELL_PX);
      t.arc(d.x * CELL_PX, d.y * CELL_PX, d.r * CELL_PX, 0, TAU);
    }
    t.fill();
  }
  tile = c;
  return c;
}

/**
 * Paints the view as dots: every image pixel becomes dotsPerSide(s)² dots of its own colour.
 * The pixels are drawn as exact blocks, then masked by a tiled dot pattern locked to the pixel
 * grid (GPU work, constant per frame whatever the image size or zoom).
 */
export function drawPointillism(ctx: CanvasRenderingContext2D, params: PointillismParams): void {
  const { tx, ty, s, cx0, cy0, cx1, cy1, brushes, scratchCanvas } = params;
  if (brushes.length === 0 || s <= 0 || cx1 <= cx0 || cy1 <= cy0) return;
  const k = ctx.getTransform().a;
  const w = Math.ceil((cx1 - cx0) * k);
  const h = Math.ceil((cy1 - cy0) * k);
  if (scratchCanvas.width !== w || scratchCanvas.height !== h) {
    scratchCanvas.width = w;
    scratchCanvas.height = h;
  }
  const l = scratchCanvas.getContext('2d');
  if (!l) return;
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.globalCompositeOperation = 'source-over';
  l.clearRect(0, 0, w, h);
  l.setTransform(k, 0, 0, k, -cx0 * k, -cy0 * k);
  l.imageSmoothingEnabled = false;
  for (const b of brushes) {
    const dx = tx + b.x * s;
    const dy = ty + b.y * s;
    if (dx + b.w * s < cx0 || dx > cx1 || dy + b.h * s < cy0 || dy > cy1) continue;
    l.drawImage(b.bmp, dx, dy, b.w * s, b.h * s);
  }
  const pattern = l.createPattern(dotTile(), 'repeat');
  if (!pattern) return;
  const cell = s / dotsPerSide(s);
  const period = DOT_TILE_CELLS * cell;
  pattern.setTransform(new DOMMatrix([cell / CELL_PX, 0, 0, cell / CELL_PX,
    patternOrigin(tx, period), patternOrigin(ty, period)]));
  l.imageSmoothingEnabled = true;
  l.globalCompositeOperation = 'destination-in';
  l.fillStyle = pattern;
  l.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  ctx.drawImage(scratchCanvas, cx0, cy0, cx1 - cx0, cy1 - cy0);
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
