import type { WorkMsg } from '@/shared/proto/messages';
import type { Orient, Work } from './types';

export type Filter = 'all' | Orient | string;

export function tagOfWork(id: string, name?: string): string | undefined {
  if (id.includes('/')) {
    const parts = id.split('/');
    return parts.slice(0, -1).join('/');
  }
  if (name && name.startsWith('[') && name.includes(']')) {
    return name.slice(1, name.indexOf(']'));
  }
  return undefined;
}

export function applyWork(prev: Map<string, Work>, m: WorkMsg): Map<string, Work> {
  const next = new Map(prev);
  if (m.event === 4) {
    next.delete(m.id);
    return next;
  }
  const tag = tagOfWork(m.id, m.name);
  next.set(m.id, {
    id: m.id,
    name: m.name,
    width: m.width,
    height: m.height,
    estratos: m.estratos,
    estado: m.estado as Work['estado'],
    edition: m.edition,
    progreso: m.progreso,
    tag,
  });
  return next;
}

export function filterWorks(list: Work[], f: Filter): Work[] {
  if (f === 'all') return list;
  if (f === 'landscape') return list.filter((w) => w.width >= w.height);
  if (f === 'portrait') return list.filter((w) => w.width < w.height);
  return list.filter((w) => w.tag === f);
}

export function fixtureWorks(): Work[] {
  const defs: Array<[string, number, number]> = [
    ['Plate 01', 3600, 2400],
    ['Plate 02', 2400, 3600],
    ['Plate 03', 3600, 2400],
    ['Plate 04', 3600, 2400],
    ['Plate 05', 2400, 3600],
    ['Plate 06', 3600, 2400],
    ['Plate 07', 2400, 3600],
    ['Plate 08', 3600, 2400],
    ['Plate 09', 3600, 2400],
    ['Plate 10', 2400, 3600],
    ['Plate 11', 3600, 2400],
    ['Plate 12', 3600, 2400],
  ];
  return defs.map(([name, width, height], i) => ({
    id: 'lamina-' + String(i + 1).padStart(2, '0'),
    name,
    width,
    height,
    estratos: 11,
    estado: 3 as const,
    edition: 2,
    progreso: 100,
  }));
}
