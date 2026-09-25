import { useMemo, useRef, useState } from 'react';
import { ViewerChrome, type ChromeApi, type ViewSync } from '@/widgets/ViewerChrome';
import { ViewerToolbar } from '@/widgets/ViewerToolbar';
import { ViewerMinimap } from '@/widgets/ViewerMinimap';
import { ViewerInfoPanel } from '@/widgets/ViewerInfoPanel';
import { ViewerTopBar } from '@/widgets/ViewerTopBar';
import { StatusPill } from '@/widgets/StatusPill';
import { LoadError } from '@/widgets/LoadError';
import { buildPresets } from '@/widgets/ZoomMenu';
import { useSeurat } from '@/app/providers/SeuratProvider';
import { patchUi, useUi } from '@/app/store';
import { counterLabel } from '@/features/navigate-work';
import { fmtPct } from '@/shared/lib/zoom';
import { Icon } from '@/shared/ui/Icon';
import {
  POINTILLIST_ZOOM_THRESHOLD_PCT,
  VIEWER_MAX_ZOOM,
  POINTILLIST_AUTO_ZOOM,
  ZOOM_STEP_FACTOR,
} from '@/shared/config/view';
import { useViewerWork } from './useViewerWork';
import { buildViewerInfoRows } from './viewerInfoRows';
import styles from './ViewerPage.module.css';

export function ViewerPage({ id }: { id: string }): JSX.Element {
  const ui = useUi();
  const seurat = useSeurat();
  const [view, setView] = useState<ViewSync | null>(null);
  const api = useRef<ChromeApi | null>(null);

  const { idx, n, iw, ih, title, dims, mp, err, loading, ready, retry, go, back, onSyncMotion } =
    useViewerWork(id, seurat);

  const pct = view?.pct ?? 100;
  const frac = view?.frac ?? 0;
  const fitPct = view?.fitPct ?? 100;
  const inDots = view?.inDots ?? false;

  const presets = useMemo(
    () => buildPresets(pct, fitPct, VIEWER_MAX_ZOOM, POINTILLIST_ZOOM_THRESHOLD_PCT / 100),
    [pct, fitPct],
  );
  const workTag = seurat.works[idx]?.tag;
  const rows = useMemo(
    () => buildViewerInfoRows(dims, mp, iw, ih, fitPct, seurat.status, workTag),
    [dims, mp, iw, ih, fitPct, seurat.status, workTag],
  );

  const handleBack = (): void => back(ui.menu, ui.info);
  const handleToggleDots = (): void => {
    if ((view?.s ?? 1) < POINTILLIST_ZOOM_THRESHOLD_PCT / 100) {
      patchUi({ dots: true });
      api.current?.zoomTo(POINTILLIST_AUTO_ZOOM);
    } else {
      patchUi({ dots: !ui.dots });
    }
  };

  const dotsActive = inDots || (ui.dots && (view?.s ?? 0) >= POINTILLIST_ZOOM_THRESHOLD_PCT / 100);

  return (
    <div className={styles.container}>
      <ViewerChrome
        iw={iw}
        ih={ih}
        handle={seurat.opened?.handle ?? 0}
        sink={seurat.sink}
        paintTick={seurat.paintTick}
        gazeService={seurat.gazeService}
        loupe={ui.loupe}
        dots={ui.dots}
        dotThreshold={POINTILLIST_ZOOM_THRESHOLD_PCT}
        maxZoom={VIEWER_MAX_ZOOM}
        apiRef={api}
        actions={{
          onToggleLoupe: () => patchUi({ loupe: !ui.loupe }),
          onToggleDots: handleToggleDots,
          onToggleInfo: () => patchUi({ info: !ui.info }),
          onPrev: () => go(-1),
          onNext: () => go(1),
          onBack: handleBack,
          onCloseMenu: () => { if (ui.menu) patchUi({ menu: false }); },
        }}
        onSync={(s) => {
          setView(s);
          onSyncMotion(s);
        }}
      />
      <ViewerTopBar
        title={title}
        dims={dims}
        mp={mp}
        counter={counterLabel(idx, n)}
        infoActive={ui.info}
        onBack={handleBack}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onToggleInfo={() => patchUi({ info: !ui.info })}
      />
      {inDots && (
        <div className={styles.pointillistBanner}>
          <Icon name="blur_on" size={20} />Pointillist view · 1 dot = 1 pixel
        </div>
      )}
      {loading && (
        <div className={styles.loadingNotice}>Loading {title} · {dims} px</div>
      )}
      {err && <LoadError onRetry={retry} />}
      <StatusPill view={view} />
      <ViewerToolbar
        pctLabel={fmtPct(pct)}
        frac={frac}
        menu={ui.menu}
        presets={presets}
        loupe={ui.loupe}
        dots={dotsActive}
        onZoomIn={() => api.current?.zoomTo((view?.s ?? 1) * ZOOM_STEP_FACTOR)}
        onZoomOut={() => api.current?.zoomTo((view?.s ?? 1) / ZOOM_STEP_FACTOR)}
        onSlide={(f) => api.current?.slideTo(f)}
        onToggleMenu={() => patchUi({ menu: !ui.menu })}
        onPreset={(p) => {
          if (p.zoom === null) api.current?.fit(false);
          else {
            api.current?.zoomTo(p.zoom / 100);
            if (p.zoom >= POINTILLIST_ZOOM_THRESHOLD_PCT) patchUi({ dots: true });
          }
          patchUi({ menu: false });
        }}
        onFit={() => api.current?.fit(false)}
        onOneToOne={() => api.current?.zoomTo(1)}
        onToggleLoupe={() => patchUi({ loupe: !ui.loupe })}
        onToggleDots={handleToggleDots}
      />
      <ViewerMinimap api={api} view={view} iw={iw} ih={ih} ready={ready} sink={seurat.sink} paintTick={seurat.paintTick} />
      {ui.info && <ViewerInfoPanel rows={rows} onClose={() => patchUi({ info: false })} />}
    </div>
  );
}
