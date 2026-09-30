#!/bin/bash
# Keeps the Next dev server alive across silent exits in the sandbox.
# Also pins DATABASE_URL so a stale/regressed .env can never boot us onto SQLite.
cd /home/z/my-project
export DATABASE_URL="postgresql://tradepulse:tradepulse@127.0.0.1:5432/tradepulse?connection_limit=8&pool_timeout=30"
while true; do
  bun run dev >> /tmp/tp-dev.log 2>&1
  echo "[$(date)] [supervisor] server exited (code $?), restarting in 2s" >> /tmp/tp-dev.log
  sleep 2
done
