import { useEffect, useMemo, useRef, useState } from 'react';
import { ViewerChrome, type ChromeApi, type ViewSync } from '@/widgets/ViewerChrome';
import { ViewerToolbar } from '@/widgets/ViewerToolbar';
import { ViewerMinimap } from '@/widgets/ViewerMinimap';
import { ViewerInfoPanel } from '@/widgets/ViewerInfoPanel';
import { StatusPill } from '@/widgets/StatusPill';
import { LoadError } from '@/widgets/LoadError';
import { buildPresets } from '@/widgets/ZoomMenu';
import { useSeurat } from '@/app/providers/SeuratProvider';
import { goGallery, goViewer } from '@/app/router';
import { patchUi, useUi } from '@/app/store';
import { stepIndex, counterLabel } from '@/features/navigate-work';
import { workDims, workMp, workTitle } from '@/entities/work/types';
import { fmtPct } from '@/shared/lib/zoom';
import { Icon } from '@/shared/ui/Icon';
import { pillStyle } from '@/features/toggle-loupe';

const DOT_THRESHOLD = 1200;
const MAX_ZOOM = 64;

export function ViewerPage({ id }: { id: string }): JSX.Element {
  const ui = useUi();
  const seurat = useSeurat();
  const [view, setView] = useState<ViewSync | null>(null);
  const [attempt, setAttempt] = useState(0);
  const api = useRef<ChromeApi | null>(null);
  const miradaInit = useRef(false);

  const idx = Math.max(0, seurat.works.findIndex((w) => w.id === id));
  const work = seurat.works[idx] ?? seurat.works[0];
  const n = seurat.works.length;

  useEffect(() => {
    miradaInit.current = false;
    setView(null);
    if (seurat.client && seurat.bienvenida) {
      seurat.closeWork();
      seurat.client.openObra(id);
    }
    return () => {
      seurat.closeWork();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt, seurat.bienvenida]);

  useEffect(() => {
    const onVis = (): void => {
      if (document.visibilityState === 'hidden' && seurat.opened && seurat.gazeService) {
        seurat.gazeService.hidden(seurat.opened.handle);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [seurat.opened, seurat.gazeService]);

  const iw = work ? work.width : 3600;
  const ih = work ? work.height : 2400;
  const title = work ? workTitle(work, idx) : 'Plate 01';
  const dims = work ? workDims(work) : '';
  const mp = work ? workMp(work) : '';

  const err = seurat.lastError?.fatal === 1 || seurat.status.startsWith('offline');
  const loading = !err && (seurat.paintTick === 0 || !seurat.opened);
  const ready = !loading && !err;

  const pct = view?.pct ?? 100;
  const frac = view?.frac ?? 0;
  const fitPct = view?.fitPct ?? 100;
  const inDots = view?.inDots ?? false;

  const presets = useMemo(
    () => buildPresets(pct, fitPct, MAX_ZOOM, DOT_THRESHOLD / 100),
    [pct, fitPct],
  );

  const rows = useMemo(() => {
    const orient = iw >= ih ? '3 : 2' : '2 : 3';
    return [
      { k: 'Dimensions', v: dims + ' px' },
      { k: 'Resolution', v: mp },
      ...(work?.tag ? [{ k: 'Tag', v: work.tag }] : []),
      { k: 'Aspect ratio', v: orient },
      { k: 'Fit zoom', v: fmtPct(fitPct) },
      { k: 'Max zoom', v: (MAX_ZOOM * 100).toLocaleString('en-US') + '%' },
      { k: 'Dots from', v: DOT_THRESHOLD.toLocaleString('en-US') + '%' },
      { k: 'Source', v: seurat.status },
    ];
  }, [dims, mp, iw, ih, fitPct, seurat.status, work?.tag]);

  const go = (d: number): void => {
    const next = seurat.works[stepIndex(idx, d, n)];
    if (next) goViewer(next.id);
  };

  const back = (): void => {
    if (ui.menu) {
      patchUi({ menu: false });
      return;
    }
    if (ui.info) {
      patchUi({ info: false });
      return;
    }
    goGallery();
  };

  const handleToggleDots = (): void => {
    const currentS = view?.s ?? 1;
    const th = DOT_THRESHOLD / 100;
    if (currentS < th) {
      patchUi({ dots: true });
      api.current?.zoomTo(16);
    } else {
      patchUi({ dots: !ui.dots });
    }
  };

  const dotsActive = inDots || (ui.dots && (view?.s ?? 0) >= DOT_THRESHOLD / 100);

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#0D0E13', color: '#E3E1E9', fontFamily: "'Roboto Flex',system-ui,sans-serif", userSelect: 'none' }}>
      <ViewerChrome
        iw={iw}
        ih={ih}
        handle={seurat.opened?.handle ?? 0}
        sink={seurat.sink}
        paintTick={seurat.paintTick}
        gazeService={seurat.gazeService}
        loupe={ui.loupe}
        dots={ui.dots}
        dotThreshold={DOT_THRESHOLD}
        maxZoom={MAX_ZOOM}
        apiRef={api}
        actions={{
          onToggleLoupe: () => patchUi({ loupe: !ui.loupe }),
          onToggleDots: handleToggleDots,
          onToggleInfo: () => patchUi({ info: !ui.info }),
          onPrev: () => go(-1),
          onNext: () => go(1),
          onBack: back,
          onCloseMenu: () => {
            if (ui.menu) patchUi({ menu: false });
          },
        }}
        onSync={(s) => {
          setView(s);
          if (!miradaInit.current && seurat.gazeService && seurat.opened) {
            miradaInit.current = true;
            seurat.gazeService.motion({
              handle: seurat.opened.handle,
              x0: 0, y0: 0, x1: iw, y1: ih,
              vw: Math.round(s.w), vh: Math.round(s.h), mflags: 0,
            });
          }
        }}
      />

      <div style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, pointerEvents: 'none' }}>
        <div className="glass-pill" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12, padding: '6px 24px 6px 6px', borderRadius: 32 }}>
          <button onClick={back} title="Back to library (Esc)" className="visor-btn" style={{ width: 48, height: 48, background: '#34343A' }}>
            <Icon name="arrow_back" size={24} />
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 17, fontWeight: 650, fontVariationSettings: "'wdth' 112" }}>{title}</span>
            <span style={{ fontSize: 12, color: '#C5C6D0', fontVariantNumeric: 'tabular-nums' }}>{dims} px · {mp}</span>
          </div>
        </div>
        <div className="glass-pill" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 2, padding: 6, borderRadius: 32 }}>
          <button onClick={() => go(-1)} title="Previous ([)" className="visor-btn" style={{ width: 48, height: 48 }}>
            <Icon name="chevron_left" size={24} />
          </button>
          <span style={{ minWidth: 56, textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#C5C6D0', fontVariantNumeric: 'tabular-nums' }}>{counterLabel(idx, n)}</span>
          <button onClick={() => go(1)} title="Next (])" className="visor-btn" style={{ width: 48, height: 48 }}>
            <Icon name="chevron_right" size={24} />
          </button>
          <div style={{ width: 1, height: 28, background: '#45464F', margin: '0 6px' }} />
          <button
            onClick={() => patchUi({ info: !ui.info })}
            title="Details (I)"
            className="visor-btn-spring"
            style={{
              width: 48, height: 48,
              borderRadius: ui.info ? 16 : 24, background: ui.info ? '#B8C4FF' : 'transparent',
              color: ui.info ? '#1F2D6F' : '#E3E1E9',
            }}
          >
            <Icon name="info" size={24} />
          </button>
        </div>
      </div>

      {inDots ? (
        <div style={{ position: 'absolute', top: 92, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 16px 0 12px', borderRadius: 18, background: '#FF8A5B', color: '#380D00', fontSize: 14, fontWeight: 600, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <Icon name="blur_on" size={20} />Pointillist view · 1 dot = 1 pixel
        </div>
      ) : null}

      {loading ? (
        <div style={{ position: 'absolute', left: '50%', top: 'calc(50% + 60px)', transform: 'translateX(-50%)', fontSize: 14, color: '#C5C6D0', whiteSpace: 'nowrap' }}>Loading {title} · {dims} px</div>
      ) : null}

      {err ? (
        <LoadError
          onRetry={() => {
            setAttempt((a) => a + 1);
            seurat.retryConnect();
          }}
        />
      ) : null}

      <StatusPill view={view} />

      <ViewerToolbar
        pctLabel={fmtPct(pct)}
        frac={frac}
        menu={ui.menu}
        presets={presets}
        loupe={pillStyle(ui.loupe)}
        dots={pillStyle(dotsActive)}
        onZoomIn={() => api.current?.zoomTo((view?.s ?? 1) * 1.6)}
        onZoomOut={() => api.current?.zoomTo((view?.s ?? 1) / 1.6)}
        onSlide={(f) => api.current?.slideTo(f)}
        onToggleMenu={() => patchUi({ menu: !ui.menu })}
        onPreset={(p) => {
          if (p.zoom === null) {
            api.current?.fit(false);
          } else {
            api.current?.zoomTo(p.zoom / 100);
            if (p.zoom >= DOT_THRESHOLD) patchUi({ dots: true });
          }
          patchUi({ menu: false });
        }}
        onFit={() => api.current?.fit(false)}
        onOneToOne={() => api.current?.zoomTo(1)}
        onToggleLoupe={() => patchUi({ loupe: !ui.loupe })}
        onToggleDots={handleToggleDots}
      />

      <ViewerMinimap api={api} view={view} iw={iw} ih={ih} ready={ready} sink={seurat.sink} paintTick={seurat.paintTick} />

      {ui.info ? <ViewerInfoPanel rows={rows} onClose={() => patchUi({ info: false })} /> : null}
    </div>
  );
}
