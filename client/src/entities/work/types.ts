export type EstadoObra = 0 | 1 | 2 | 3 | 4 | 5;
export type Orient = 'landscape' | 'portrait';

export interface Work {
  id: string;
  nombre: string;
  ancho: number;
  alto: number;
  estratos: number;
  estado: EstadoObra;
  edicion: number;
  progreso: number;
}

export function orientOf(w: Work): Orient {
  return w.ancho >= w.alto ? 'landscape' : 'portrait';
}

export function dimsOf(w: Work): string {
  return w.ancho.toLocaleString('en-US') + ' × ' + w.alto.toLocaleString('en-US');
}

export function mpOf(w: Work): string {
  return ((w.ancho * w.alto) / 1e6).toFixed(1) + ' MP';
}

export function titleOf(w: Work, index: number): string {
  if (w.nombre && w.nombre.length > 0) return w.nombre;
  return 'Plate ' + String(index + 1).padStart(2, '0');
}
