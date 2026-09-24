#!/usr/bin/env bash
# Enforces file budgets: prod <150 LoC, tests <300 LoC.
# Usage: bash check-loc.sh [root] — defaults to repo root.
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MAIN_MAX=150
TEST_MAX=300
fail=0
check() {
  local file="$1" max="$2" kind="$3"
  local n
  n=$(wc -l < "$file")
  if [ "$n" -ge "$max" ]; then
    echo "OVER BUDGET [$kind] $file: $n >= $max (split by responsibility)"
    fail=1
  fi
}
while IFS= read -r -d '' f; do check "$f" "$MAIN_MAX" "main"; done < <(find "$ROOT/src/main" -name '*.java' -print0 2>/dev/null || true)
while IFS= read -r -d '' f; do check "$f" "$TEST_MAX" "test"; done < <(find "$ROOT/src/test" -name '*.java' -print0 2>/dev/null || true)
if [ "$fail" -eq 0 ]; then echo "LoC budgets OK (main<$MAIN_MAX, test<$TEST_MAX)"; else exit 1; fi
