import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SessionClient, type SessionEvents } from './session-client';
import { DeliverySink } from './delivery-sink';
import { applyWork } from '@/entities/work/store';
import type { Work } from '@/entities/work/types';
import type { Abierta, Bienvenida, Concession, PlanMsg, ProtoError } from '@/shared/proto/messages';
import { GazeSender } from '@/features/send-gaze';
import { PreviewManager } from '@/features/preview-works';

export interface SeuratState {
  status: string;
  works: Work[];
  bienvenida: Bienvenida | null;
  opened: Abierta | null;
  concession: Concession | null;
  plan: PlanMsg | null;
  lastError: ProtoError | null;
  paintTick: number;
  client: SessionClient | null;
  sink: DeliverySink | null;
  gazeService: GazeSender | null;
  retryConnect(): void;
  closeWork(): void;
}

const Ctx = createContext<SeuratState | null>(null);

export function useSeurat(): SeuratState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSeurat outside provider');
  return v;
}

export function SeuratProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState('boot');
  const [works, setWorks] = useState<Work[]>([]);
  const [bienvenida, setBienvenida] = useState<Bienvenida | null>(null);
  const [opened, setAbierta] = useState<Abierta | null>(null);
  const [concession, setConcesion] = useState<Concession | null>(null);
  const [plan, setPlan] = useState<PlanMsg | null>(null);
  const [lastError, setLastError] = useState<ProtoError | null>(null);
  const [paintTick, setPaintTick] = useState(0);
  const clientRef = useRef<SessionClient | null>(null);
  const sinkRef = useRef<DeliverySink | null>(null);
  const miradasRef = useRef<GazeSender | null>(null);
  const worksRef = useRef(new Map<string, Work>());
  const previewRef = useRef<PreviewManager | null>(null);

  useEffect(() => {
    let alive = true;
    const preview = new PreviewManager(() => clientRef.current);
    previewRef.current = preview;
    const events: SessionEvents = {
      onBienvenida: (b) => {
        if (alive) setBienvenida(b);
      },
      onObra: (m) => {
        worksRef.current = applyWork(worksRef.current, m);
        const list = [...worksRef.current.values()];
        if (alive) {
          setWorks(list);
          previewRef.current?.enqueue(list.map((w) => w.id));
        }
      },
      onAbierta: (a) => {
        if (!alive) return;
        previewRef.current?.pause();
        if (sinkRef.current && sinkRef.current.handle !== a.handle) {
          const prev = sinkRef.current.handle;
          sinkRef.current.dispose();
          clientRef.current?.closeHandle(prev);
        }
        setAbierta(a);
        const sink = new DeliverySink(
          a.handle,
          () => clientRef.current,
          () => concessionRef.current?.maxKiB ?? 36864,
          () => concessionRef.current?.maxBrushes ?? 768,
          a.semillaAncho,
          a.semillaAlto,
        );
        sinkRef.current = sink;
      },
      onPreviewAbierta: (id, a) => {
        previewRef.current?.onAbierta(id, a);
      },
      onPreviewError: (id) => {
        previewRef.current?.onError(id);
      },
      onConcesion: (c) => {
        if (sinkRef.current && sinkRef.current.handle !== c.handle) return;
        concessionRef.current = c;
        if (alive) setConcesion(c);
      },
      onPlan: (p) => {
        if (sinkRef.current?.handle !== p.handle) return;
        if (alive) setPlan(p);
        if (p.event === 2) sinkRef.current?.applyPlanCanceladas(p.cancelled);
      },
      onRaspar: (r) => {
        if (sinkRef.current?.handle !== r.handle) return;
        sinkRef.current?.applyRaspar(r, () => performance.now());
        if (alive) setPaintTick((t) => t + 1);
      },
      onRenovar: (r) => {
        if (sinkRef.current?.handle !== r.handle) return;
        sinkRef.current?.applyRenovar(r.ranges, r.order, r.leaseS, () => performance.now());
      },
      onAuditar: (a) => {
        if (sinkRef.current?.handle !== a.handle) return;
        const inv = sinkRef.current?.inventory(a.through);
        if (inv && clientRef.current) {
          clientRef.current.sendInventory(a.handle, a.order, a.through, inv.brushCount, inv.kib, inv.ranges);
        }
      },
      onProtoError: (e) => {
        if (e.codigo === 12) {
          sinkRef.current?.dispose();
          sinkRef.current = null;
          setAbierta(null);
          setConcesion(null);
          previewRef.current?.resume();
        }
        if (alive) setLastError(e);
      },
      onDelivery: (bytes) => {
        if (previewRef.current?.onDelivery(bytes)) return;
        sinkRef.current?.ingest(bytes, () => performance.now(), () => {
          if (alive) setPaintTick((t) => t + 1);
        }, concessionRef.current?.leaseS ?? 120);
      },
      onStatus: (s) => {
        if (alive) setStatus(s);
      },
    };
    const concessionRef: { current: Concession | null } = { current: null };
    const client = new SessionClient(events);
    clientRef.current = client;
    miradasRef.current = new GazeSender(() => clientRef.current?.activeTransport ?? null);
    client.boot().then(
      () => {
        if (alive) client.requestCatalog();
      },
      (e: unknown) => {
        if (alive) setStatus('offline: ' + (e instanceof Error ? e.message : String(e)));
      },
    );
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') {
        const h = sinkRef.current;
        void h;
      }
    };
    const onHide = (): void => {
      client.sendAdios();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    const sweep = window.setInterval(() => {
      sinkRef.current?.sweepExpiry(() => performance.now());
    }, 1000);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
      window.clearInterval(sweep);
      miradasRef.current?.dispose();
      previewRef.current?.dispose();
      previewRef.current = null;
      sinkRef.current?.dispose();
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  const retryConnect = (): void => {
    setStatus('boot');
    setLastError(null);
    clientRef.current?.boot().then(
      () => {
        clientRef.current?.requestCatalog();
      },
      (e: unknown) => {
        setStatus('offline: ' + (e instanceof Error ? e.message : String(e)));
      },
    );
  };

  const closeWork = (): void => {
    if (sinkRef.current) {
      const h = sinkRef.current.handle;
      sinkRef.current.dispose();
      sinkRef.current = null;
      clientRef.current?.closeHandle(h);
    }
    setAbierta(null);
    setConcesion(null);
    setPlan(null);
    previewRef.current?.resume();
  };

  const value = useMemo<SeuratState>(
    () => ({
      status, works, bienvenida, opened, concession, plan, lastError, paintTick,
      client: clientRef.current, sink: sinkRef.current, gazeService: miradasRef.current,
      retryConnect, closeWork,
    }),
    [status, works, bienvenida, opened, concession, plan, lastError, paintTick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
