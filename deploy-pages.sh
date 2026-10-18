#!/bin/bash
# Build + terbitkan frontend SBIM ke GitHub Pages (branch gh-pages).
# URL tetap: https://alongakunbisnis2.github.io/Menti-sbim/
# Dipanggil otomatis oleh tunnel.sh setiap URL backend berubah.
# Struktur situs: / , /room/ , /presenter/ , /config.js , /templates/
cd /root/menti-sbim || exit 1
LOG=pages-deploy.log
BASE=/Menti-sbim            # sub-path project site GitHub Pages
REMOTE=origin
BRANCH=gh-pages
WT=/tmp/ghp                 # worktree untuk branch gh-pages
BUILD=/tmp/pages-build

log(){ echo "[$(date)] $*" >> $LOG; }

U=$(cat .public_url 2>/dev/null)
[ -z "$U" ] && U=NONE       # NONE = sengaja tanpa backend publik (mode venue LAN)

# ---------- 1. build situs ----------
rm -rf "$BUILD"; mkdir -p "$BUILD/room" "$BUILD/presenter" "$BUILD/templates"
cp public/templates/sbim-camp.json "$BUILD/templates/"
cp public/*.png "$BUILD/" 2>/dev/null
cp public/*.svg "$BUILD/" 2>/dev/null
cp public/*.ico "$BUILD/" 2>/dev/null
cp public/ws-io.js "$BUILD/" 2>/dev/null
cp public/index.html      "$BUILD/index.html"
cp public/room.html       "$BUILD/room/index.html"
cp public/presenter.html  "$BUILD/presenter/index.html"

# bibata config.js: absolut ke sub-path Pages, supaya jalan dari /room/ dan /presenter/
for f in "$BUILD/index.html" "$BUILD/room/index.html" "$BUILD/presenter/index.html"; do
  sed -i 's|<script src="config.js"></script>||g' "$f"
  # rujukan dalam situs ("/xxx") -> sub-path Pages ("$BASE/xxx"); literal JS pakai kutip tunggal jadi tidak tersentuh
  sed -i "s|\"/|\"$BASE/|g" "$f"
  # config.js disuntik TERAKHIR supaya tidak kena prefiks ganda
  sed -i "s|</head>|<script src=\"$BASE/config.js?v=$(date +%s)\"></script>\n</head>|" "$f"
done
touch "$BUILD/.nojekyll"

# ---------- 2. config.js: daftar kandidat backend (failover di frontend) ----------
if [ "$U" = "NONE" ]; then
  printf 'var SURGE_BACKENDS = [];\nvar SURGE_BACKEND = "";\n' > "$BUILD/config.js"
else
  cands="$(cat /tmp/url_workers 2>/dev/null) $U $(cat /tmp/url_cf 2>/dev/null) $(cat /tmp/url_lhr 2>/dev/null) $(cat /tmp/url_pg 2>/dev/null) $(cat /tmp/url_lt 2>/dev/null)"
  cands=$(echo "$cands" | tr ' ' '\n' | sed 's|/$||' | awk 'NF && !seen[$0]++' | sed 's/.*/"&"/' | paste -sd, -)
  {
    printf 'var SURGE_BACKENDS = [%s];\n' "$cands"
    # backend utama = Workers (24/7, tanpa tunnel); tunnel hanya cadangan
    printf 'var SURGE_BACKEND = "%s";\n' "$(cat /tmp/url_workers 2>/dev/null || echo "$U")"
  } > "$BUILD/config.js"
fi

# ---------- 3. terbitkan ke branch gh-pages ----------
if [ ! -d "$WT" ]; then
  rm -rf "$WT"
  git worktree add -B "$BRANCH" "$WT" >/dev/null 2>&1 || { log "gagal buat worktree gh-pages"; exit 1; }
fi
find "$WT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} + 2>/dev/null
cp -R "$BUILD/." "$WT/"
(cd "$WT" && git add -A \
  && git -c user.name="SBIM Camp" -c user.email="sbimcamp@local" commit -q -m "pages: backend ${U} @ $(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>/dev/null; \
  git push -q "$REMOTE" "$BRANCH" 2>/tmp/pages-push.err) \
  && log "deploy OK -> https://alongakunbisnis2.github.io$BASE/ (backend utama $(cat /tmp/url_workers 2>/dev/null || echo "$U"))" \
  || log "deploy GAGAL: $(tail -c 200 /tmp/pages-push.err 2>/dev/null)"
