import { SESSION_PATH } from '../config/constants';

export interface SesionResponse {
  token: string;
  lienzo: string;
  respaldo: string;
  versiones: number[];
  lado: number;
}

export async function postSesion(cliente: string, memMiB: number, transportes: string[]): Promise<SesionResponse> {
  const res = await fetch(SESSION_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ cliente, memMiB, transportes }),
  });
  if (!res.ok) throw new Error('sesion http ' + res.status);
  const body = (await res.json()) as SesionResponse;
  if (typeof body.token !== 'string' || typeof body.lienzo !== 'string' || typeof body.respaldo !== 'string') {
    throw new Error('sesion: bad response');
  }
  return body;
}
