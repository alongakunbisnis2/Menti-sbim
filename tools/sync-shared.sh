#!/usr/bin/env bash
# Salin aset bersama (shared/web) ke public/ tiap aplikasi.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for app in quiziz nilai; do
  [ -d "$ROOT/$app/public" ] || continue
  cp -a "$ROOT/shared/web/." "$ROOT/$app/public/"
  echo "  $app/public <- shared/web"
done
echo "aset bersama disalin."
