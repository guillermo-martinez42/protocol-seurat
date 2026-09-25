import type { WorkMessage } from '@/shared/proto/messages';
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

export function applyWork(prev: Map<string, Work>, m: WorkMessage): Map<string, Work> {
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
    strata: m.strata,
    state: m.state as Work['state'],
    edition: m.edition,
    progress: m.progress,
    tag,
  });
  return next;
}

export function compareWorksAsc(a: Work, b: Work): number {
  const nameA = a.name && a.name.length > 0 ? a.name : a.id;
  const nameB = b.name && b.name.length > 0 ? b.name : b.id;
  const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  return cmp !== 0 ? cmp : a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortWorks(list: Work[]): Work[] {
  return [...list].sort(compareWorksAsc);
}

export function filterWorks(list: Work[], f: Filter): Work[] {
  let res = list;
  if (f === 'landscape') res = list.filter((w) => w.width >= w.height);
  else if (f === 'portrait') res = list.filter((w) => w.width < w.height);
  else if (f !== 'all') res = list.filter((w) => w.tag === f);
  return sortWorks(res);
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
    strata: 11,
    state: 3 as const,
    edition: 2,
    progress: 100,
  }));
}
