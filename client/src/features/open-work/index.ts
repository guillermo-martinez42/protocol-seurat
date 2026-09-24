export function openWorkHref(id: string): string {
  return '#/visor/' + encodeURIComponent(id);
}

export function parseOpenHash(hash: string): string | null {
  const m = /^#\/visor\/(.+)$/.exec(hash);
  return m?.[1] ? decodeURIComponent(m[1] as string) : null;
}
