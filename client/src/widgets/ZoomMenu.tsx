import { Icon } from '@/shared/ui/Icon';
import { PRESET_MATCH_TOLERANCE, ZOOM_PRESET_TIERS } from '@/shared/config/view';
import styles from './ZoomMenu.module.css';

export interface Preset {
  label: string;
  note: string;
  on: boolean;
  zoom: number | null;
}

export function buildPresets(pct: number, fitPct: number, maxS: number, th: number): Preset[] {
  const fmt = (n: number): string => (n < 10 ? n.toFixed(1) + '%' : Math.round(n).toLocaleString('en-US') + '%');
  return ZOOM_PRESET_TIERS
    .filter((z) => z === null || z / 100 <= maxS)
    .map((z) => ({
      label: z === null ? 'Fit to screen' : z.toLocaleString('en-US') + '%',
      note: z === null ? fmt(fitPct) : z === 100 ? 'Actual pixels' : z / 100 >= th ? 'Dots' : '',
      on: z === null ? Math.abs(pct - fitPct) < PRESET_MATCH_TOLERANCE : Math.abs(pct - z) < PRESET_MATCH_TOLERANCE,
      zoom: z,
    }));
}

export function ZoomMenu({ presets, onPick }: { presets: Preset[]; onPick(p: Preset): void }): JSX.Element {
  return (
    <>
      {presets.map((p) => (
        <button key={p.label} onClick={() => onPick(p)} className="menu-preset-btn">
          <span>{p.label}</span>
          <span className={styles.note}>
            {p.note}
            {p.on ? <Icon name="check" size={20} className={styles.check} /> : null}
          </span>
        </button>
      ))}
    </>
  );
}
