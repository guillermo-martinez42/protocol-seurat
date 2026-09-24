export function hash3(x: number, y: number): [number, number, number] {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return [(h & 1023) / 1023, ((h >>> 10) & 1023) / 1023, ((h >>> 20) & 1023) / 1023];
}
