#!/usr/bin/env bash
# Mode venue: server + papan presenter di laptop, peserta ikut lewat WiFi yang sama.
# Tidak butuh tunnel/Surge/internet. Jalankan: bash mulai-lan.sh
cd "$(dirname "$0")"
IP=$(ip -4 addr show scope global 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
[ -z "$IP" ] && IP=$(hostname -I 2>/dev/null | awk '{print $1}')
PORT=${PORT:-3000}
if ! curl -s -m 4 "http://127.0.0.1:$PORT/health" | grep -q ok; then
  echo "▸ menyalakan server…"
  NODE_OPTIONS=--dns-result-order=ipv4first setsid nohup node server.js > server.log 2>&1 < /dev/null &
  for i in $(seq 1 30); do sleep 2; curl -s -m 4 "http://127.0.0.1:$PORT/health" | grep -q ok && break; done
fi
echo
echo "  PAPAN PRESENTER (buka di laptop, tekan ⛶ untuk layar penuh):"
echo "     http://localhost:$PORT/presenter/"
echo
echo "  UNTUK PESERTA (QR di papan sudah otomatis pakai alamat ini):"
echo "     http://$IP:$PORT/"
echo
echo "  Catatan: laptop & HP harus di WiFi yang sama, dan izinkan port $PORT di firewall."
