import { useEffect, useState, useRef } from 'react';
import type { SeuratState } from '@/app/providers/SeuratProvider';
import type { ViewSync } from '@/widgets/ViewerChrome';
import { goGallery, goViewer } from '@/app/router';
import { patchUi } from '@/app/store';
import { stepIndex } from '@/features/navigate-work';
import { workDims, workMp, workTitle } from '@/entities/work/types';
import { DEFAULT_WORK_WIDTH, DEFAULT_WORK_HEIGHT } from '@/shared/config/view';

export function useViewerWork(id: string, seurat: SeuratState) {
  const [attempt, setAttempt] = useState(0);
  const miradaInit = useRef(false);

  const idx = Math.max(0, seurat.works.findIndex((w) => w.id === id));
  const work = seurat.works[idx] ?? seurat.works[0];
  const n = seurat.works.length;

  useEffect(() => {
    miradaInit.current = false;
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

  const iw = work ? work.width : DEFAULT_WORK_WIDTH;
  const ih = work ? work.height : DEFAULT_WORK_HEIGHT;
  const title = work ? workTitle(work, idx) : 'Plate 01';
  const dims = work ? workDims(work) : '';
  const mp = work ? workMp(work) : '';

  const err = seurat.lastError?.fatal === 1 || seurat.status.startsWith('offline');
  const loading = !err && (seurat.paintTick === 0 || !seurat.opened);
  const ready = !loading && !err;

  const retry = (): void => {
    setAttempt((a) => a + 1);
    seurat.retryConnect();
  };

  const go = (d: number): void => {
    const next = seurat.works[stepIndex(idx, d, n)];
    if (next) goViewer(next.id);
  };

  const back = (menuOpen: boolean, infoOpen: boolean): void => {
    if (menuOpen) return patchUi({ menu: false });
    if (infoOpen) return patchUi({ info: false });
    goGallery();
  };

  const onSyncMotion = (s: ViewSync): void => {
    if (!miradaInit.current && seurat.gazeService && seurat.opened) {
      miradaInit.current = true;
      seurat.gazeService.motion({
        handle: seurat.opened.handle,
        x0: 0, y0: 0, x1: iw, y1: ih,
        vw: Math.round(s.w), vh: Math.round(s.h), mflags: 0,
      });
    }
  };

  return {
    idx, n, iw, ih, title, dims, mp, err, loading, ready, retry, go, back, onSyncMotion,
  };
}
