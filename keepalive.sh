#!/bin/bash
# Watchdog: pastikan backend + penjaga tunnel selalu hidup. Cek tiap 20 detik.
cd /root/menti-sbim || exit 1
echo "[$(date)] watchdog start (pid $$)" >> keepalive.log

restart_backend(){
  [ -f .server.pid ] && kill "$(cat .server.pid)" 2>/dev/null
  pkill -f '[n]ode server.js' 2>/dev/null
  rm -f .server.pid; sleep 1
  nohup node server.js >> server.log 2>&1 &
  echo $! > .server.pid
  echo "[$(date)] backend restart PID $(cat .server.pid)" >> keepalive.log
}

while true; do
  # 1. backend lokal
  if ! curl -s -m 6 http://127.0.0.1:3000/health | grep -q '"ok":true'; then
    restart_backend
    sleep 5
    curl -s -m 6 http://127.0.0.1:3000/health | grep -q '"ok":true' || echo "[$(date)] backend tetap mati" >> keepalive.log
  fi

  # 2. penjaga tunnel
  if ! pgrep -f 'bash /root/menti-sbim/tunnel.sh' >/dev/null 2>&1; then
    echo "[$(date)] keeper mati, hidupkan ulang" >> keepalive.log
    setsid -f nohup bash /root/menti-sbim/tunnel.sh >/dev/null 2>&1 < /dev/null
  fi

  # 3. URL publik harus hidup (toleransi 2x gagal — anti-flapping)
  U=$(cat .public_url 2>/dev/null)
  if [ -n "$U" ]; then
    if curl -s -m 10 "$U/health" 2>/dev/null | grep -q '"ok":true'; then
      echo 0 > /tmp/url_fail
    else
      f=$(( $(cat /tmp/url_fail 2>/dev/null || echo 0) + 1 )); echo $f > /tmp/url_fail
      if [ $f -ge 2 ]; then
        echo "[$(date)] url publik $U mati ${f}x — paksa publish ulang" >> keepalive.log
        rm -f .public_url; echo 0 > /tmp/url_fail
      fi
    fi
  fi

  sleep 20
done
