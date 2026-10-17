#!/bin/bash
# Start backend menti-sbim (idempotent, pakai PID file — tanpa PM2)
cd /root/menti-sbim || exit 1
if [ -f .server.pid ] && kill -0 "$(cat .server.pid)" 2>/dev/null; then
  echo "Sudah jalan PID $(cat .server.pid)"
else
  nohup node server.js >> server.log 2>&1 &
  echo $! > .server.pid
  echo "Backend started PID $(cat .server.pid)"
fi
sleep 2
curl -s http://127.0.0.1:3000/health && echo " OK"
