import { Slider } from '@/shared/ui/Slider';
import { Menu } from '@/shared/ui/Menu';
import { Icon } from '@/shared/ui/Icon';
import { ZoomMenu, type Preset } from './ZoomMenu';

interface Props {
  pctLabel: string;
  frac: number;
  menu: boolean;
  presets: Preset[];
  loupe: { bg: string; fg: string; r: string };
  dots: { bg: string; fg: string; r: string };
  onZoomIn(): void;
  onZoomOut(): void;
  onSlide(f: number): void;
  onToggleMenu(): void;
  onPreset(p: Preset): void;
  onFit(): void;
  onOneToOne(): void;
  onToggleLoupe(): void;
  onToggleDots(): void;
}

export function ViewerToolbar(p: Props): JSX.Element {
  return (
    <div style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 4, padding: 8, borderRadius: 36, background: '#1E1F25', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
      <button onClick={p.onZoomOut} title="Zoom out (−)" className="visor-btn" style={{ width: 48, height: 48 }}>
        <Icon name="remove" size={24} />
      </button>
      <Slider frac={p.frac} onSeek={p.onSlide} />
      <button onClick={p.onZoomIn} title="Zoom in (+)" className="visor-btn" style={{ width: 48, height: 48 }}>
        <Icon name="add" size={24} />
      </button>
      <div style={{ position: 'relative' }}>
        <button onClick={p.onToggleMenu} title="Zoom levels" className="visor-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 104, height: 48, padding: '0 10px 0 16px', borderRadius: 24, background: '#414659', color: '#DDE1F9', fontSize: 15, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
          {p.pctLabel}<Icon name="arrow_drop_down" size={22} />
        </button>
        <Menu open={p.menu}>
          <ZoomMenu presets={p.presets} onPick={p.onPreset} />
        </Menu>
      </div>
      <div style={{ width: 1, height: 28, background: '#45464F', margin: '0 6px' }} />
      <button onClick={p.onFit} title="Fit to screen (0)" className="visor-btn" style={{ width: 48, height: 48 }}>
        <Icon name="fit_screen" size={24} />
      </button>
      <button onClick={p.onOneToOne} title="Actual pixels (1)" className="visor-btn" style={{ width: 48, height: 48, fontSize: 15, fontWeight: 750 }}>1:1</button>
      <div style={{ width: 1, height: 28, background: '#45464F', margin: '0 6px' }} />
      <button onClick={p.onToggleLoupe} title="Loupe (L)" className="visor-btn-spring" style={{ width: 48, height: 48, borderRadius: p.loupe.r, background: p.loupe.bg, color: p.loupe.fg }}>
        <Icon name="search" size={24} />
      </button>
      <button onClick={p.onToggleDots} title="Pointillist pixels (P)" className="visor-btn-spring" style={{ width: 48, height: 48, borderRadius: p.dots.r, background: p.dots.bg, color: p.dots.fg }}>
        <Icon name="blur_on" size={24} />
      </button>
    </div>
  );
}
