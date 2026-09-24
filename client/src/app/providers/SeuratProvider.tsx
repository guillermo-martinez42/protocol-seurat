import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SessionClient, type SessionEvents } from './session-client';
import { DeliverySink } from './delivery-sink';
import { applyObra, fixtureWorks } from '@/entities/work/store';
import type { Work } from '@/entities/work/types';
import type { Abierta, Bienvenida, Concesion, PlanMsg, ProtoError } from '@/shared/proto/messages';
import { MiradaSender } from '@/features/send-mirada';

export interface SeuratState {
  status: string;
  works: Work[];
  bienvenida: Bienvenida | null;
  abierta: Abierta | null;
  concesion: Concesion | null;
  plan: PlanMsg | null;
  lastError: ProtoError | null;
  paintTick: number;
  client: SessionClient | null;
  sink: DeliverySink | null;
  miradas: MiradaSender | null;
  retryConnect(): void;
}

const Ctx = createContext<SeuratState | null>(null);

export function useSeurat(): SeuratState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSeurat outside provider');
  return v;
}

export function SeuratProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState('boot');
  const [works, setWorks] = useState<Work[]>(() => fixtureWorks());
  const [bienvenida, setBienvenida] = useState<Bienvenida | null>(null);
  const [abierta, setAbierta] = useState<Abierta | null>(null);
  const [concesion, setConcesion] = useState<Concesion | null>(null);
  const [plan, setPlan] = useState<PlanMsg | null>(null);
  const [lastError, setLastError] = useState<ProtoError | null>(null);
  const [paintTick, setPaintTick] = useState(0);
  const clientRef = useRef<SessionClient | null>(null);
  const sinkRef = useRef<DeliverySink | null>(null);
  const miradasRef = useRef<MiradaSender | null>(null);
  const worksRef = useRef(new Map<string, Work>());

  useEffect(() => {
    let alive = true;
    const events: SessionEvents = {
      onBienvenida: (b) => {
        if (alive) setBienvenida(b);
      },
      onObra: (m) => {
        worksRef.current = applyObra(worksRef.current, m);
        if (alive) setWorks([...worksRef.current.values()]);
      },
      onAbierta: (a) => {
        if (!alive) return;
        setAbierta(a);
        const sink = new DeliverySink(
          a.handle,
          () => clientRef.current,
          () => concesionRef.current?.maxKib ?? 36864,
          () => concesionRef.current?.maxPinceladas ?? 768,
          a.semillaAncho,
          a.semillaAlto,
        );
        sinkRef.current = sink;
      },
      onConcesion: (c) => {
        concesionRef.current = c;
        if (alive) setConcesion(c);
      },
      onPlan: (p) => {
        if (alive) setPlan(p);
        if (p.evento === 2) sinkRef.current?.applyPlanCanceladas(p.canceladas);
      },
      onRaspar: (r) => {
        sinkRef.current?.applyRaspar(r, () => performance.now());
        if (alive) setPaintTick((t) => t + 1);
      },
      onRenovar: (r) => {
        sinkRef.current?.applyRenovar(r.rangos, r.orden, r.arriendoS, () => performance.now());
      },
      onAuditar: (a) => {
        const inv = sinkRef.current?.inventory(a.hasta);
        if (inv && clientRef.current) {
          clientRef.current.sendInventario(a.handle, a.orden, a.hasta, inv.pinceladas, inv.kib, inv.rangos);
        }
      },
      onProtoError: (e) => {
        if (e.codigo === 12) {
          sinkRef.current?.dispose();
          sinkRef.current = null;
          setAbierta(null);
          setConcesion(null);
        }
        if (alive) setLastError(e);
      },
      onDelivery: (bytes) => {
        sinkRef.current?.ingest(bytes, () => performance.now(), () => {
          if (alive) setPaintTick((t) => t + 1);
        }, concesionRef.current?.arriendoS ?? 120);
      },
      onStatus: (s) => {
        if (alive) setStatus(s);
      },
    };
    const concesionRef: { current: Concesion | null } = { current: null };
    const client = new SessionClient(events);
    clientRef.current = client;
    miradasRef.current = new MiradaSender(() => clientRef.current?.activeTransport ?? null);
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

  const value = useMemo<SeuratState>(
    () => ({
      status, works, bienvenida, abierta, concesion, plan, lastError, paintTick,
      client: clientRef.current, sink: sinkRef.current, miradas: miradasRef.current,
      retryConnect,
    }),
    [status, works, bienvenida, abierta, concesion, plan, lastError, paintTick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
