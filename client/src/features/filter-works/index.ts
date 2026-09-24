import type { CSSProperties } from 'react';
import type { Filter } from '@/entities/work/store';

export function nextFilter(current: Filter, pick: Filter): Filter {
  return pick === current ? current : pick;
}

export function chipStyle(on: boolean): CSSProperties {
  if (on) {
    return {
      display: 'flex', alignItems: 'center', gap: 6, height: 40, padding: '0 18px 0 12px',
      border: 'none', borderRadius: 12, background: '#DEE1F9', color: '#171B2C',
      fontSize: 14, fontWeight: 600, cursor: 'pointer',
    };
  }
  return {
    display: 'flex', alignItems: 'center', height: 40, padding: '0 18px',
    border: '1px solid #C5C6D0', borderRadius: 20, background: 'transparent',
    color: '#45464F', fontSize: 14, fontWeight: 500, cursor: 'pointer',
  };
}

export function clampFilter(f: string): Filter {
  return f === 'landscape' || f === 'portrait' ? f : 'all';
}
