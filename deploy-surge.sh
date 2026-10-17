#!/bin/bash
# Build + deploy frontend SBIM ke Surge (akun lama) dengan URL rapi tanpa .html.
# Struktur: / , /room , /presenter , /config.js , /templates/sbim-camp.json
# Dipanggil otomatis oleh tunnel.sh tiap kali URL tunnel berubah.
cd /root/menti-sbim || exit 1
DOMAIN=${1:-sbimcamp.surge.sh}
TOK=$(cat .surge-old-token 2>/dev/null)
[ -z "$TOK" ] && { echo "[$(date)] token surge tidak ada" >> surge-deploy.log; exit 1; }
# --- backoff kalau Surge membatasi (rate limit) ---
BLOCK=/tmp/surge_block
if [ -f "$BLOCK" ]; then
  age=$(( $(date +%s) - $(cat "$BLOCK" 2>/dev/null || echo 0) ))
  if [ "$age" -lt 1800 ]; then echo "[$(date)] dilewati: masih dalam backoff rate-limit ($age s)" >> surge-deploy.log; exit 0; fi
fi

U=$(cat .public_url 2>/dev/null)
# NONE = sengaja deploy tanpa backend publik (tunnel mati / mode venue LAN):
# frontend langsung jatuh ke mode demo, tidak menggantung menunggu tunnel mati.
[ -z "$U" ] && U=NONE

# --- build surge/ ---
rm -rf surge; mkdir -p surge/room surge/presenter surge/templates
cp public/templates/sbim-camp.json surge/templates/
# aset gambar (logo resmi dll)
cp public/*.png surge/ 2>/dev/null
cp public/*.svg surge/ 2>/dev/null
cp public/*.ico surge/ 2>/dev/null
cp public/index.html surge/index.html
cp public/room.html    surge/room/index.html
cp public/presenter.html surge/presenter/index.html
# config.js: absolut supaya jalan dari /room/ dan /presenter/
for f in surge/index.html surge/room/index.html surge/presenter/index.html; do
  sed -i 's|<script src="config.js"></script>||g' "$f"
  sed -i 's|</head>|<script src="/config.js"></script>\n</head>|' "$f"
done
# config.js: kandidat backend sehat (current dulu), biar frontend bisa failover
# Tanpa health-gate di sini: URL tunnel berganti cepat sehingga cek di sini balapan
# (ketahuan 1 dari 2 kandidat hilang). Frontend sudah probe /health tiap kandidat.
if [ "$U" = "NONE" ]; then
  printf 'var SURGE_BACKENDS = [];\nvar SURGE_BACKEND = "";\n' > surge/config.js
else
  cands="$U $(cat /tmp/url_cf 2>/dev/null) $(cat /tmp/url_lhr 2>/dev/null) $(cat /tmp/url_pg 2>/dev/null) $(cat /tmp/url_lt 2>/dev/null)"
  cands=$(echo "$cands" | tr ' ' '\n' | sed 's|/$||' | awk 'NF && !seen[$0]++' | sed 's/.*/"&"/' | paste -sd, -)
  {
    printf 'var SURGE_BACKENDS = [%s];\n' "$cands"
    printf 'var SURGE_BACKEND = "%s";\n' "$U"
  } > surge/config.js
fi

tar -czf /tmp/site.tgz -C /root/menti-sbim surge
OUT=$(curl -s -m 90 -X PUT "https://surge.surge.sh/$DOMAIN" -u "token:$TOK" \
  -H "version: 0.41.2" -H "Accept: application/x-ndjson" \
  -H "Content-Type: application/gzip" --data-binary @/tmp/site.tgz 2>&1)

if echo "$OUT" | grep -qi "rate limited"; then
  date +%s > "$BLOCK"
  echo "[$(date)] RATE LIMITED — backoff 30 menit ($DOMAIN)" >> surge-deploy.log
elif echo "$OUT" | grep -q "\"domain\":\"$DOMAIN\""; then
  echo "[$(date)] deploy OK -> https://$DOMAIN (backend $U)" >> surge-deploy.log
else
  echo "[$(date)] deploy GAGAL ($DOMAIN): $(echo "$OUT" | head -c 200)" >> surge-deploy.log
fi
