#!/usr/bin/env bash
# Seurat/1 LAN run: static viewer + Java server on one port. Offline-safe.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .seurat/runtime/{inbox,obras,cobertura} .seurat/build/classes

# Rebuild the viewer when a JS toolchain is available; otherwise serve the
# committed client/dist. Never fails the boot.
if [ -f client/package.json ] && { command -v pnpm >/dev/null || command -v npm >/dev/null; }; then
  (cd client && (pnpm build 2>/dev/null || npm run build 2>/dev/null)) || echo "client build skipped"
fi

FLAGS=()
RUN_FLAGS=()
if java -version 2>&1 | grep -q 'version "20\.'; then
  FLAGS=(--enable-preview --release 20)
  RUN_FLAGS=(--enable-preview)
fi

<<<<<<< HEAD
javac "${FLAGS[@]}" -d .seurat/build/classes $(find src/main/java -name '*.java')
# Ingest heap grows with image width (~2.5 GB live at 196,608 px); 6G leaves GC headroom.
exec java "${RUN_FLAGS[@]}" -Xmx6G -cp .seurat/build/classes seurat.SeuratServer "$@"
=======
javac "${FLAGS[@]}" -d .seurat/build/classes $(find server/src -name '*.java')
jar -cf .seurat/build/seurat.jar -C .seurat/build/classes .
HEAP="${SEURAT_HEAP:--Xmx4G}"
exec java "${RUN_FLAGS[@]}" $HEAP ${JAVA_OPTS:-} -cp .seurat/build/seurat.jar:.seurat/build/classes seurat.SeuratServer "$@"
>>>>>>> 9c712d8c97a04d5304e6153c9e590526f79ec381
