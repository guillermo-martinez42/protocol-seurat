import { useEffect, useRef } from 'react';
import { clamp } from '@/shared/lib/clamp';
import { hash3 } from '@/shared/lib/hash3';
import { logFrac } from '@/shared/lib/zoom';
import { applyFitImmediate, fitTarget } from '@/features/fit-view';
import { flingTarget, panBy } from '@/features/pan-view';
import { wheelZoom, zoomTarget } from '@/features/zoom-view';
import { initialView, tickView } from '@/features/zoom-view/model';
import { viewToRoi } from '@/entities/viewport/math';
import { splitBrushId } from '@/shared/proto/brush';
import type { DeliverySink } from '@/app/providers/delivery-sink';
import type { GazeSender } from '@/features/send-gaze';

export interface ViewSync {
  s: number;
  tx: number;
  ty: number;
  pct: number;
  frac: number;
  fitPct: number;
  px: { x: string; y: string; hex: string | null } | null;
  inDots: boolean;
  w: number;
  h: number;
}

export interface ChromeApi {
  zoomTo(ns: number, px?: number, py?: number): void;
  fit(imm: boolean): void;
  panTo(ix: number, iy: number): void;
  slideTo(f: number): void;
}

export interface ChromeActions {
  onToggleLoupe(): void;
  onToggleDots(): void;
  onToggleInfo(): void;
  onPrev(): void;
  onNext(): void;
  onBack(): void;
  onCloseMenu(): void;
}

interface Props {
  iw: number;
  ih: number;
  handle: number;
  sink: DeliverySink | null;
  paintTick: number;
  gazeService: GazeSender | null;
  loupe: boolean;
  dots: boolean;
  dotThreshold: number;
  maxZoom: number;
  apiRef: { current: ChromeApi | null };
  actions: ChromeActions;
  onSync(s: ViewSync): void;
}

interface BrushGeom {
  delivery: number;
  s: number;
  x: number;
  y: number;
  size: number;
  bmp: ImageBitmap;
}

export function ViewerChrome(props: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    v: initialView(),
    fitS: 0.1,
    iw: props.iw,
    ih: props.ih,
    mouse: null as { mx: number; my: number } | null,
    uiKey: '',
    grids: new Map<number, { w: number; h: number; d: Uint8ClampedArray }>(),
  });
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cv: HTMLCanvasElement = canvas;
    const st = stateRef.current;
    const P = (): Props => propsRef.current;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let raf = 0;
    let dirty = true;
    let dragging = false;
    let last = { x: 0, y: 0, t: 0 };
    let vel = { x: 0, y: 0 };
    const ptrs = new Map<number, { x: number; y: number }>();
    let pinch: { x: number; y: number; d: number } | null = null;
    let userMoved = false;
    let ctx: CanvasRenderingContext2D | null = null;

    const th = (): number => (P().dotThreshold) / 100;
    const maxS = (): number => P().maxZoom;
    const minS = (): number => st.fitS * 0.5;

    function resize(): void {
      const r = cv.getBoundingClientRect();
      W = r.width;
      H = r.height;
      dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      if (!userMoved) doFit(true);
      dirty = true;
    }

    function doFit(imm: boolean): void {
      const p = P();
      if (imm) {
        const r = applyFitImmediate(st.v, W, H, p.iw, p.ih);
        st.v = r.next;
        st.fitS = r.fitS;
      } else {
        const r = fitTarget(st.v, W, H, p.iw, p.ih);
        st.v = r.next;
        st.fitS = r.fitS;
      }
      userMoved = false;
      dirty = true;
    }

    function zoomTo(ns: number, px?: number, py?: number): void {
      const v = st.v;
      st.v = zoomTarget(v, ns, px ?? W / 2, py ?? H / 2, minS(), maxS());
      userMoved = true;
      dirty = true;
    }

    P().apiRef.current = {
      zoomTo,
      fit: (imm: boolean) => doFit(imm),
      panTo: (ix: number, iy: number) => {
        const v = st.v;
        st.v = { ...v, ttx: W / 2 - ix * v.ts, tty: H / 2 - iy * v.ts };
        userMoved = true;
        dirty = true;
      },
      slideTo: (f: number) => {
        const lo = Math.log(minS());
        const hi = Math.log(maxS());
        zoomTo(Math.exp(lo + clamp(f, 0, 1) * (hi - lo)));
      },
    };

    function brushes(): BrushGeom[] {
      const sink = P().sink;
      if (!sink) return [];
      const out: BrushGeom[] = [];
      for (const rec of sink.book.byDelivery.values()) {
        if (!rec.rgba) continue;
        const { s, bx, by } = splitBrushId(rec.brushId);
        const size = 256 * 2 ** s;
        out.push({ delivery: rec.delivery, s, x: bx * size, y: by * size, size, bmp: rec.rgba });
      }
      out.sort((a, b) => b.s - a.s);
      return out;
    }

    function gridFor(b: BrushGeom): { w: number; h: number; d: Uint8ClampedArray } | null {
      const hit = st.grids.get(b.delivery);
      if (hit) return hit;
      if (st.grids.size > 64) st.grids.clear();
      try {
        const c = document.createElement('canvas');
        c.width = 32;
        c.height = 32;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) return null;
        g.drawImage(b.bmp, 0, 0, 32, 32);
        const d = g.getImageData(0, 0, 32, 32).data;
        const e = { w: 32, h: 32, d };
        st.grids.set(b.delivery, e);
        return e;
      } catch {
        return null;
      }
    }

    function bg(): void {
      if (!ctx) return;
      const g = 26;
      ctx.fillStyle = '#0D0E13';
      ctx.fillRect(0, 0, W, H);
      const ox = (((st.v.tx * 0.4) % g) + g) % g;
      const oy = (((st.v.ty * 0.4) % g) + g) % g;
      ctx.fillStyle = 'rgba(197,198,208,0.13)';
      ctx.beginPath();
      for (let y = oy - g; y < H + g; y += g) {
        for (let x = ox - g; x < W + g; x += g) {
          ctx.moveTo(x + 1.2, y);
          ctx.arc(x, y, 1.2, 0, 6.2832);
        }
      }
      ctx.fill();
    }

    function layer(tx: number, ty: number, s: number, cx0: number, cy0: number, cx1: number, cy1: number): void {
      if (!ctx) return;
      const p = P();
      const list = brushes();
      if (list.length === 0) return;
      const dotsOn = p.dots && s >= th();
      const f = dotsOn ? Math.min(1, (s - th()) / (th() * 0.75)) : 0;
      ctx.imageSmoothingEnabled = s < 2;
      for (const b of list) {
        const dx = tx + b.x * s;
        const dy = ty + b.y * s;
        const dw = b.size * s;
        if (dx + dw < cx0 || dx > cx1 || dy + dw < cy0 || dy > cy1) continue;
        ctx.globalAlpha = 1 - f * 0.9;
        ctx.drawImage(b.bmp, dx, dy, dw, dw);
      }
      ctx.globalAlpha = 1;
      if (dotsOn) {
        const grow = 0.4 + 0.6 * f;
        for (const b of list) {
          const g = gridFor(b);
          if (!g) continue;
          for (let gy = 0; gy < g.h; gy++) {
            for (let gx = 0; gx < g.w; gx++) {
              const gi = (gy * g.w + gx) * 4;
              const step = b.size / g.w;
              const ix = b.x + gx * step + step / 2;
              const iy = b.y + gy * step + step / 2;
              let cx = tx + ix * s;
              let cy = ty + iy * s;
              let rad = s * step * 0.45;
              const [h1, h2, h3] = hash3(Math.round(ix), Math.round(iy));
              cx += (h1 - 0.5) * s * step * 0.24;
              cy += (h2 - 0.5) * s * step * 0.24;
              rad = s * step * (0.33 + 0.15 * h3);
              if (cx + rad < cx0 || cx - rad > cx1 || cy + rad < cy0 || cy - rad > cy1) continue;
              ctx.fillStyle = 'rgb(' + g.d[gi] + ',' + g.d[gi + 1] + ',' + g.d[gi + 2] + ')';
              ctx.beginPath();
              ctx.arc(cx, cy, rad * grow, 0, 6.2832);
              ctx.fill();
            }
          }
        }
      } else if (s >= 16) {
        const x0 = Math.max(0, Math.floor((cx0 - tx) / s));
        const y0 = Math.max(0, Math.floor((cy0 - ty) / s));
        const x1 = Math.min(p.iw, Math.ceil((cx1 - tx) / s));
        const y1 = Math.min(p.ih, Math.ceil((cy1 - ty) / s));
        ctx.strokeStyle = 'rgba(13,14,19,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = x0; x <= x1; x++) {
          const X = Math.round(tx + x * s) + 0.5;
          ctx.moveTo(X, ty + y0 * s);
          ctx.lineTo(X, ty + y1 * s);
        }
        for (let y = y0; y <= y1; y++) {
          const Y = Math.round(ty + y * s) + 0.5;
          ctx.moveTo(tx + x0 * s, Y);
          ctx.lineTo(tx + x1 * s, Y);
        }
        ctx.stroke();
      }
    }

    function draw(): void {
      if (!ctx) return;
      const p = P();
      const v = st.v;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bg();
      const iw = p.iw * v.s;
      const ih = p.ih * v.s;
      if (v.tx > -40 || v.ty > -40 || v.tx + iw < W + 40 || v.ty + ih < H + 40) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.55)';
        ctx.shadowBlur = 48;
        ctx.shadowOffsetY = 12;
        ctx.fillStyle = '#000';
        ctx.fillRect(Math.max(v.tx, -60), Math.max(v.ty, -60), Math.min(v.tx + iw, W + 60) - Math.max(v.tx, -60), Math.min(v.ty + ih, H + 60) - Math.max(v.ty, -60));
        ctx.restore();
      }
      layer(v.tx, v.ty, v.s, 0, 0, W, H);
      if (p.loupe && st.mouse && !dragging) {
        const { mx, my } = st.mouse;
        const R = 104;
        const L = Math.min(v.s * 4, maxS() * 4);
        const ix = (mx - v.tx) / v.s;
        const iy = (my - v.ty) / v.s;
        if (ix >= 0 && iy >= 0 && ix <= p.iw && iy <= p.ih) {
          const ltx = mx - ix * L;
          const lty = my - iy * L;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.6)';
          ctx.shadowBlur = 28;
          ctx.beginPath();
          ctx.arc(mx, my, R, 0, 6.2832);
          ctx.fillStyle = '#0D0E13';
          ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.clip();
          layer(ltx, lty, L, mx - R, my - R, mx + R, my + R);
          if (L >= 6) {
            const px = Math.floor(ix);
            const py = Math.floor(iy);
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.strokeRect(ltx + px * L, lty + py * L, L, L);
          }
          ctx.restore();
          ctx.lineWidth = 5;
          ctx.strokeStyle = '#B8C4FF';
          ctx.beginPath();
          ctx.arc(mx, my, R, 0, 6.2832);
          ctx.stroke();

          const label = '×4 · ' + (L * 100 < 1000 ? Math.round(L * 100) : Math.round(L * 100).toLocaleString('en-US')) + '%';
          ctx.font = '600 12px "Roboto Flex", system-ui, sans-serif';
          const tw = ctx.measureText(label).width + 20;
          const by = my + R + 10;
          ctx.fillStyle = '#B8C4FF';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(mx - tw / 2, by, tw, 24, 12);
          else ctx.rect(mx - tw / 2, by, tw, 24);
          ctx.fill();
          ctx.fillStyle = '#1F2D6F';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, mx, by + 12);
        }
      }
    }

    function drawLoader(): void {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bg();
      const t = performance.now() / 1000;
      const cols = ['#B8C4FF', '#FF8A5B', '#DDE1F9', '#FFB599'];
      for (let i = 0; i < 10; i++) {
        const a = t * 1.6 + i * 0.628;
        const R = 24 + 4 * Math.sin(t * 3 + i);
        ctx.fillStyle = cols[i % 4] ?? '#B8C4FF';
        ctx.beginPath();
        ctx.arc(W / 2 + Math.cos(a) * R, H / 2 + Math.sin(a) * R, 2.5 + 2.5 * (0.5 + 0.5 * Math.sin(t * 4 - i * 0.7)), 0, 6.2832);
        ctx.fill();
      }
    }

    function syncUI(): void {
      const p = P();
      const v = st.v;
      const frac = logFrac(v.s, minS(), maxS());
      const pct = v.s * 100;
      let px: ViewSync['px'] = null;
      if (st.mouse) {
        const ix = Math.floor((st.mouse.mx - v.tx) / v.s);
        const iy = Math.floor((st.mouse.my - v.ty) / v.s);
        if (ix >= 0 && iy >= 0 && ix < p.iw && iy < p.ih) {
          let hex: string | null = null;
          for (const b of brushes()) {
            if (ix >= b.x && ix < b.x + b.size && iy >= b.y && iy < b.y + b.size) {
              const g = gridFor(b);
              if (g) {
                const gx = clamp(Math.floor(((ix - b.x) / b.size) * g.w), 0, g.w - 1);
                const gy = clamp(Math.floor(((iy - b.y) / b.size) * g.h), 0, g.h - 1);
                const gi = (gy * g.w + gx) * 4;
                hex = '#' + [g.d[gi], g.d[gi + 1], g.d[gi + 2]].map((n) => (n ?? 0).toString(16).padStart(2, '0')).join('').toUpperCase();
              }
              break;
            }
          }
          px = { x: ix.toLocaleString('en-US'), y: iy.toLocaleString('en-US'), hex };
        }
      }
      const inDots = p.dots && v.s >= th();
      const key = pct.toFixed(2) + '|' + frac.toFixed(4) + '|' + (px ? px.x + ',' + px.y : '') + '|' + inDots;
      if (key !== st.uiKey) {
        st.uiKey = key;
        p.onSync({ s: v.s, tx: v.tx, ty: v.ty, pct, frac, fitPct: st.fitS * 100, px, inDots, w: W, h: H });
      }
    }

    function reportMirada(): void {
      const p = P();
      if (!p.gazeService) return;
      const v = st.v;
      const roi = viewToRoi(v.s, v.tx, v.ty, { vw: W, vh: H }, p.iw, p.ih);
      p.gazeService.motion({ handle: p.handle, x0: roi.x0, y0: roi.y0, x1: roi.x1, y1: roi.y1, vw: Math.round(W), vh: Math.round(H), mflags: 0 });
    }

    function loop(): void {
      raf = requestAnimationFrame(loop);
      if (!ctx) return;
      const v = st.v;
      const { next, moving } = tickView(v);
      st.v = next;
      const hasPaint = brushes().length > 0;
      if (!hasPaint) {
        drawLoader();
        if (moving || dirty) {
          dirty = false;
          syncUI();
          if (moving) reportMirada();
        }
        return;
      }
      if (moving || dirty) {
        dirty = false;
        draw();
        syncUI();
        if (moving) reportMirada();
      }
    }

    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomTo(wheelZoom(st.v.ts, e.deltaY, e.deltaMode, e.ctrlKey), e.clientX - r.left, e.clientY - r.top);
    }

    function pinchInfo(): { x: number; y: number; d: number } {
      const [a, b] = [...ptrs.values()] as [{ x: number; y: number }, { x: number; y: number }];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    }

    function onDown(e: PointerEvent): void {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        dragging = true;
        last = { x: e.clientX, y: e.clientY, t: performance.now() };
        vel = { x: 0, y: 0 };
      } else if (ptrs.size === 2) {
        pinch = pinchInfo();
      }
      P().actions.onCloseMenu();
    }

    function onMove(e: PointerEvent): void {
      const r = cv.getBoundingClientRect();
      const v = st.v;
      st.mouse = { mx: e.clientX - r.left, my: e.clientY - r.top };
      if (ptrs.has(e.pointerId)) {
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size >= 2 && pinch) {
          const q = pinchInfo();
          zoomTo(v.ts * (q.d / pinch.d), q.x - r.left, q.y - r.top);
          st.v = { ...st.v, s: st.v.ts, tx: st.v.ttx + (q.x - pinch.x), ty: st.v.tty + (q.y - pinch.y), ttx: st.v.ttx + (q.x - pinch.x), tty: st.v.tty + (q.y - pinch.y) };
          pinch = q;
        } else if (dragging) {
          const now = performance.now();
          const dt = Math.max(1, now - last.t);
          const dx = e.clientX - last.x;
          const dy = e.clientY - last.y;
          vel = { x: 0.8 * dx / dt + 0.2 * vel.x, y: 0.8 * dy / dt + 0.2 * vel.y };
          st.v = panBy(v, dx, dy);
          last = { x: e.clientX, y: e.clientY, t: now };
          userMoved = true;
        }
      }
      dirty = true;
    }

    function onUp(e: PointerEvent): void {
      ptrs.delete(e.pointerId);
      if (ptrs.size === 0 && dragging) {
        dragging = false;
        if (performance.now() - last.t < 60) st.v = flingTarget(st.v, vel.x, vel.y);
      } else if (ptrs.size === 1) {
        const [q] = [...ptrs.values()];
        if (q) last = { x: q.x, y: q.y, t: performance.now() };
        vel = { x: 0, y: 0 };
        pinch = null;
      }
      dirty = true;
    }

    function onLeave(): void {
      if (!dragging) {
        st.mouse = null;
        dirty = true;
      }
    }

    function onDbl(e: MouseEvent): void {
      const r = cv.getBoundingClientRect();
      zoomTo(st.v.ts * (e.shiftKey ? 0.5 : 2.5), e.clientX - r.left, e.clientY - r.top);
    }

    function onKey(e: KeyboardEvent): void {
      const a = P().actions;
      const v = st.v;
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
      const k = e.key;
      let hit = true;
      if (k === '+' || k === '=') zoomTo(v.ts * 1.6);
      else if (k === '-' || k === '_') zoomTo(v.ts / 1.6);
      else if (k === '0') doFit(false);
      else if (k === '1') zoomTo(1);
      else if (k === 'ArrowLeft') {
        st.v = { ...v, ttx: v.ttx + 180 };
        dirty = true;
      } else if (k === 'ArrowRight') {
        st.v = { ...v, ttx: v.ttx - 180 };
        dirty = true;
      } else if (k === 'ArrowUp') {
        st.v = { ...v, tty: v.tty + 180 };
        dirty = true;
      } else if (k === 'ArrowDown') {
        st.v = { ...v, tty: v.tty - 180 };
        dirty = true;
      } else if (k === 'l' || k === 'L') a.onToggleLoupe();
      else if (k === 'p' || k === 'P') a.onToggleDots();
      else if (k === 'i' || k === 'I') a.onToggleInfo();
      else if (k === '[') a.onPrev();
      else if (k === ']') a.onNext();
      else if (k === 'Escape') a.onBack();
      else hit = false;
      if (hit) e.preventDefault();
    }

    ctx = cv.getContext('2d');
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', onLeave);
    cv.addEventListener('dblclick', onDbl);
    window.addEventListener('keydown', onKey);
    resize();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      cv.removeEventListener('pointerleave', onLeave);
      cv.removeEventListener('dblclick', onDbl);
      window.removeEventListener('keydown', onKey);
      ptrs.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.iw, props.ih, props.handle]);

  useEffect(() => {
    stateRef.current.iw = props.iw;
    stateRef.current.ih = props.ih;
  }, [props.iw, props.ih]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: props.loupe ? 'crosshair' : 'grab' }}
    />
  );
}
