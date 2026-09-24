const TABLE = new Uint32Array(256);

function build(): void {
  const poly = 0x82f63b78;
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? poly ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
}

build();

export function crc32c(bytes: Uint8Array, prev = 0xffffffff): number {
  let c = prev >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    c = (TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function crc32cHex(bytes: Uint8Array): string {
  return crc32c(bytes).toString(16).padStart(8, '0');
}
