import { Icon } from '@/shared/ui/Icon';

export interface Preset {
  label: string;
  note: string;
  on: boolean;
  zoom: number | null;
}

export function buildPresets(pct: number, fitPct: number, maxS: number, th: number): Preset[] {
  const all: Array<number | null> = [null, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 25600];
  const fmt = (n: number): string => (n < 10 ? n.toFixed(1) + '%' : Math.round(n).toLocaleString('en-US') + '%');
  return all
    .filter((z) => z === null || z / 100 <= maxS)
    .map((z) => ({
      label: z === null ? 'Fit to screen' : z.toLocaleString('en-US') + '%',
      note: z === null ? fmt(fitPct) : z === 100 ? 'Actual pixels' : z / 100 >= th ? 'Dots' : '',
      on: z === null ? Math.abs(pct - fitPct) < 0.3 : Math.abs(pct - z) < 0.3,
      zoom: z,
    }));
}

export function ZoomMenu({ presets, onPick }: { presets: Preset[]; onPick(p: Preset): void }): JSX.Element {
  return (
    <>
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onPick(p)}
          className="menu-preset-btn"
        >
          <span>{p.label}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8F909A', fontSize: 12 }}>
            {p.note}{p.on ? <Icon name="check" size={20} style={{ color: '#B8C4FF' }} /> : null}
          </span>
        </button>
      ))}
    </>
  );
}
