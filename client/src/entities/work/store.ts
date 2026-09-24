import type { ObraMsg } from '@/shared/proto/messages';
import type { Orient, Work } from './types';

export type Filter = 'all' | Orient;

export function applyObra(prev: Map<string, Work>, m: ObraMsg): Map<string, Work> {
  const next = new Map(prev);
  if (m.evento === 4) {
    next.delete(m.id);
    return next;
  }
  next.set(m.id, {
    id: m.id,
    nombre: m.nombre,
    ancho: m.ancho,
    alto: m.alto,
    estratos: m.estratos,
    estado: m.estado as Work['estado'],
    edicion: m.edicion,
    progreso: m.progreso,
  });
  return next;
}

export function filterWorks(list: Work[], f: Filter): Work[] {
  if (f === 'all') return list;
  return list.filter((w) => (w.ancho >= w.alto ? 'landscape' : 'portrait') === f);
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
  return defs.map(([nombre, ancho, alto], i) => ({
    id: 'lamina-' + String(i + 1).padStart(2, '0'),
    nombre,
    ancho,
    alto,
    estratos: 11,
    estado: 3 as const,
    edicion: 2,
    progreso: 100,
  }));
}
