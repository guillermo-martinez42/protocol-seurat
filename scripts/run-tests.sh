#!/usr/bin/env bash
# Compiles and runs every Java test (JDK-only mains, `java -ea`).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="target/test-classes"
mkdir -p "$OUT"
javac -d "$OUT" $(find src/main/java src/test/java -name '*.java')
pass=0
fail=0
for t in $(cd src/test/java && find . -name '*Test.java' | sed 's|^\./||; s|\.java$||; s|/|.|g'); do
  if java -ea -cp "$OUT" "$t" > "/tmp/opencode/test-$t.log" 2>&1; then
    echo "PASS $t"
    pass=$((pass + 1))
  else
    echo "FAIL $t (see /tmp/opencode/test-$t.log)"
    tail -n 15 "/tmp/opencode/test-$t.log"
    fail=$((fail + 1))
  fi
done
echo "---"
if [ -f .agents/skills/java-guardrails/scripts/check-loc.sh ]; then
  bash .agents/skills/java-guardrails/scripts/check-loc.sh
elif [ -f .opencode/skills/java-guardrails/scripts/check-loc.sh ]; then
  bash .opencode/skills/java-guardrails/scripts/check-loc.sh
fi
[ "$fail" -eq 0 ]
