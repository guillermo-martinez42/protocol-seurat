export type WorkState = 0 | 1 | 2 | 3 | 4 | 5;
export type Orient = 'landscape' | 'portrait';

export interface Work {
  id: string;
  name: string;
  width: number;
  height: number;
  estratos: number;
  estado: WorkState;
  edition: number;
  progreso: number;
  tag?: string;
}

export function orientOf(w: Work): Orient {
  return w.width >= w.height ? 'landscape' : 'portrait';
}

export function workDims(w: Work): string {
  return w.width.toLocaleString('en-US') + ' × ' + w.height.toLocaleString('en-US');
}

export function workMp(w: Work): string {
  return ((w.width * w.height) / 1e6).toFixed(1) + ' MP';
}

export function workTitle(w: Work, index: number): string {
  if (w.name && w.name.length > 0) return w.name;
  return 'Plate ' + String(index + 1).padStart(2, '0');
}
