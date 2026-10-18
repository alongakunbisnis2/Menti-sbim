#!/bin/bash
# Penjaga TIGA tunnel publik (cloudflared + localhost.run + pinggy.io) untuk failover.
# Peserta selalu memakai tautan Surge, jadi pergantian URL backend tidak memutus mereka.
# - Tiap tunnel punya URL tersimpan sendiri.
# - Yang sehat dipakai; .public_url hanya berubah kalau yang aktif benar-benar mati.
# - Ping rutin anti-idle. Sinkron ke surge/config.js.
cd /root/menti-sbim || exit 1
LOG=tunnel.log
CF=bin/cloudflared
CFURL=/tmp/url_cf; LHRURL=/tmp/url_lhr; PGURL=/tmp/url_pg
CFMIN=/tmp/cf_last; LHRMIN=/tmp/lhr_last; PGMIN=/tmp/pg_last
CFFAIL=/tmp/cf_fail; LHRFAIL=/tmp/lhr_fail; PGFAIL=/tmp/pg_fail; CURFAIL=/tmp/cur_fail

log(){ echo "[$(date)] $*" >> $LOG; }

healthy(){ # retry 2x, cepat
  local i
  for i in 1 2; do
    curl -s -m 6 "$1/health" 2>/dev/null | grep -q '"ok":true' && return 0
    sleep 2
  done
  return 1
}
failn(){ # $1=file penghitung
  local f; f=$(cat "$1" 2>/dev/null || echo 0); f=$((f+1)); echo "$f" > "$1"; echo "$f"
}

wait_up(){ # $1=url, tunggu sampai benar-benar sehat (max ~75s)
  local i
  for i in $(seq 1 15); do
    healthy "$1" && return 0
    sleep 5
  done
  return 1
}

ensure_cf(){
  # proses hidup + URL sehat? tidak perlu apa-apa
  if pgrep -f 'bin/[c]loudflared' >/dev/null 2>&1 && [ -s $CFURL ]; then
    healthy "$(cat $CFURL)" && { echo 0 > $CFFAIL; return; }
    [ "$(failn $CFFAIL)" -lt 2 ] && return   # beri 1 putaran lagi sebelum restart (anti-flapping)
  fi
  local now last; now=$(date +%s); last=$(cat $CFMIN 2>/dev/null || echo 0)
  [ $((now-last)) -lt 60 ] && return   # jangan restart terlalu cepat
  echo $now > $CFMIN
  pkill -9 -f 'bin/[c]loudflared' 2>/dev/null; sleep 1
  rm -f /tmp/cf.log
  nohup "$CF" tunnel --no-autoupdate --edge-ip-version 4 --protocol http2 --url http://127.0.0.1:3000 > /tmp/cf.log 2>&1 &
  local U
  for _ in $(seq 1 40); do
    U=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/cf.log 2>/dev/null | grep -v '^https://api\.trycloudflare\.com$' | head -1)
    [ -n "$U" ] && { echo "$U" > $CFURL; echo 0 > $CFFAIL; log "cloudflared dapat URL: $U"; return; }
    sleep 1
  done
  log "cloudflared gagal dapat URL"
}

ensure_lhr(){
  if pgrep -f 'nokey@[l]ocalhost.run' >/dev/null 2>&1 && [ -s $LHRURL ]; then
    healthy "$(cat $LHRURL)" && { echo 0 > $LHRFAIL; return; }
    [ "$(failn $LHRFAIL)" -lt 2 ] && return
  fi
  local now last; now=$(date +%s); last=$(cat $LHRMIN 2>/dev/null || echo 0)
  [ $((now-last)) -lt 60 ] && return
  echo $now > $LHRMIN
  pkill -9 -f 'nokey@[l]ocalhost.run' 2>/dev/null; sleep 1
  rm -f /tmp/lhr.log
  nohup ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes -R 80:127.0.0.1:3000 nokey@localhost.run > /tmp/lhr.log 2>&1 &
  local U
  for _ in $(seq 1 30); do
    U=$(grep -oE "https://[a-z0-9]+\.lhr\.life" /tmp/lhr.log 2>/dev/null | grep -v admin | head -1)
    [ -n "$U" ] && { echo "$U" > $LHRURL; echo 0 > $LHRFAIL; log "localhost.run dapat URL: $U"; return; }
    sleep 1
  done
  log "localhost.run gagal dapat URL"
}

ensure_pg(){ # pinggy.io — penyedia lain, tanpa akun (masa berlaku 60 menit, penjaga menyegarkan)
  if pgrep -f '[a]\.pinggy\.io' >/dev/null 2>&1 && [ -s $PGURL ]; then
    healthy "$(cat $PGURL)" && { echo 0 > $PGFAIL; return; }
    [ "$(failn $PGFAIL)" -lt 2 ] && return
  fi
  local now last; now=$(date +%s); last=$(cat $PGMIN 2>/dev/null || echo 0)
  [ $((now-last)) -lt 60 ] && return
  echo $now > $PGMIN
  pkill -9 -f '[a]\.pinggy\.io' 2>/dev/null; sleep 1
  rm -f /tmp/pg.log
  nohup ssh -p 443 -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes -R0:127.0.0.1:3000 a.pinggy.io > /tmp/pg.log 2>&1 &
  local U
  for _ in $(seq 1 30); do
    U=$(grep -oE "https://[a-z0-9-]+\.run\.pinggy-free\.link" /tmp/pg.log 2>/dev/null | head -1)
    [ -z "$U" ] && U=$(grep -oE "https://[a-z0-9-]+\.free\.pinggy\.net" /tmp/pg.log 2>/dev/null | head -1)
    [ -n "$U" ] && { echo "$U" > $PGURL; echo 0 > $PGFAIL; log "pinggy dapat URL: $U"; return; }
    sleep 1
  done
  log "pinggy gagal dapat URL"
}

publish(){
  local cur cf lhr
  cur=$(cat .public_url 2>/dev/null)
  if [ -n "$cur" ]; then
    if healthy "$cur"; then
      echo 0 > $CURFAIL
      curl -s -m 10 -o /dev/null "$cur/health" 2>/dev/null
      return
    fi
    if [ "$(failn $CURFAIL)" -lt 2 ]; then
      curl -s -m 6 -o /dev/null "$cur/health" 2>/dev/null   # tetap ping anti-idle
      return
    fi
  fi
  cf=$(cat $CFURL 2>/dev/null); lhr=$(cat $LHRURL 2>/dev/null); pg=$(cat $PGURL 2>/dev/null)
  if [ -n "$cf" ] && healthy "$cf"; then
    echo "$cf" > .public_url
  elif [ -n "$lhr" ] && healthy "$lhr"; then
    echo "$lhr" > .public_url
  elif [ -n "$pg" ] && healthy "$pg"; then
    echo "$pg" > .public_url
  else
    return
  fi
  echo 0 > $CURFAIL
  log "URL aktif: $(cat .public_url)"
  setsid -f nohup bash deploy-pages.sh >/dev/null 2>&1   # sinkron ke Surge
}

log "tunnel keeper (dual) start"
n=0
while true; do
  ensure_cf
  ensure_lhr
  ensure_pg
  publish
  n=$((n+1))
  # terbitkan ulang GitHub Pages tiap ~10 menit (jaga daftar kandidat backend tetap baru)
  if [ $((n % 30)) -eq 0 ]; then
    setsid -f nohup bash deploy-pages.sh >/dev/null 2>&1
  fi
  sleep 20
done
