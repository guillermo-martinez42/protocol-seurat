#!/usr/bin/env bash
# Seurat/1 LAN run: static viewer + Java server on one port. Offline-safe.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p inbox obras cobertura target/classes

# Rebuild the viewer when a JS toolchain is available; otherwise serve the
# committed client/dist (or web/ fallback). Never fails the boot.
if [ -f client/package.json ] && { command -v pnpm >/dev/null || command -v npm >/dev/null; }; then
  (cd client && (pnpm build 2>/dev/null || npm run build 2>/dev/null)) || echo "client build skipped"
fi

javac -d target/classes $(find src/main/java -name '*.java')
exec java -Xmx2G -cp target/classes seurat.SeuratServer "$@"
