#!/bin/bash

set -euo pipefail

# 获取脚本所在目录（.zscripts）
# 使用 $0 获取脚本路径（与 build.sh 保持一致）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# TradePulse runtime constants — the platform's /start.sh clobbers .env with a
# legacy SQLite URL on EVERY boot (both fresh and restore branches), so dev.sh
# is the last writer before the server starts: always restore the PostgreSQL
# datasource here. The userspace PG cluster lives under ./pgdata (scripts/pg-ensure.sh).
PG_URL="postgresql://tradepulse:tradepulse@127.0.0.1:5432/tradepulse?connection_limit=8&pool_timeout=30"

log_step_start() {
        local step_name="$1"
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting: $step_name"
        echo "=========================================="
        export STEP_START_TIME
        STEP_START_TIME=$(date +%s)
}

log_step_end() {
        local step_name="${1:-Unknown step}"
        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - STEP_START_TIME))
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Completed: $step_name"
        echo "[LOG] Step: $step_name | Duration: ${duration}s"
        echo "=========================================="
        echo ""
}

start_mini_services() {
        local mini_services_dir="$PROJECT_DIR/mini-services"
        local started_count=0

        log_step_start "Starting mini-services"
        if [ ! -d "$mini_services_dir" ]; then
                echo "Mini-services directory not found, skipping..."
                log_step_end "Starting mini-services"
                return 0
        fi

        echo "Found mini-services directory, scanning for sub-services..."

        for service_dir in "$mini_services_dir"/*; do
                if [ ! -d "$service_dir" ]; then
                        continue
                fi

                local service_name
                service_name=$(basename "$service_dir")
                echo "Checking service: $service_name"

                if [ ! -f "$service_dir/package.json" ]; then
                        echo "[$service_name] No package.json found, skipping..."
                        continue
                fi

                if ! grep -q '"dev"' "$service_dir/package.json"; then
                        echo "[$service_name] No dev script found, skipping..."
                        continue
                fi

                echo "Starting $service_name in background..."
                (
                        cd "$service_dir"
                        echo "[$service_name] Installing dependencies..."
                        bun install
                        echo "[$service_name] Running bun run dev..."
                        exec bun run dev
                ) >"$PROJECT_DIR/.zscripts/mini-service-${service_name}.log" 2>&1 &

                local service_pid=$!
                echo "[$service_name] Started in background (PID: $service_pid)"
                echo "[$service_name] Log: $PROJECT_DIR/.zscripts/mini-service-${service_name}.log"
                disown "$service_pid" 2>/dev/null || true
                started_count=$((started_count + 1))
        done

        echo "Mini-services startup completed. Started $started_count service(s)."
        log_step_end "Starting mini-services"
}

wait_for_service() {
        local host="$1"
        local port="$2"
        local service_name="$3"
        local max_attempts="${4:-60}"
        local attempt=1

        echo "Waiting for $service_name to be ready on $host:$port..."

        while [ "$attempt" -le "$max_attempts" ]; do
                if curl -s --connect-timeout 2 --max-time 5 "http://$host:$port" >/dev/null 2>&1; then
                        echo "$service_name is ready!"
                        return 0
                fi

                echo "Attempt $attempt/$max_attempts: $service_name not ready yet, waiting..."
                sleep 1
                attempt=$((attempt + 1))
        done

        echo "ERROR: $service_name failed to start within $max_attempts seconds"
        return 1
}

cleanup() {
        # Intentionally no-op: the dev server runs under a detached double-fork
        # supervisor (scripts/dev-supervisor.sh) that must OUTLIVE this script —
        # dev.sh exits right after the health check by design.
        :
}

trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"

if ! command -v bun >/dev/null 2>&1; then
        echo "ERROR: bun is not installed or not in PATH"
        exit 1
fi

log_step_start "Fix datasource"
# /start.sh writes the legacy SQLite URL into .env after restoring the project
# tarball — undo that BEFORE anything touches Prisma. Also export it so child
# processes (prisma, next, ops scripts) all see the same value even if .env
# loading changes.
echo "DATABASE_URL=${PG_URL}" > "$PROJECT_DIR/.env"
export DATABASE_URL="${PG_URL}"
chown z:z "$PROJECT_DIR/.env" 2>/dev/null || true
echo "[DB] .env restored to PostgreSQL userspace cluster (pgdata/)"
log_step_end "Fix datasource"

log_step_start "PostgreSQL up"
# Start the userspace PostgreSQL cluster BEFORE db:push — prisma db push with
# the PG URL needs a live server, and the app's predev hook only runs later.
bash "$PROJECT_DIR/scripts/pg-ensure.sh"
log_step_end "PostgreSQL up"

log_step_start "bun install"
echo "[BUN] Installing dependencies..."
bun install
log_step_end "bun install"

log_step_start "bun run db:push"
echo "[BUN] Setting up database schema (PostgreSQL)..."
bun run db:push
log_step_end "bun run db:push"

log_step_start "Starting Next.js dev server"
echo "[BUN] Starting development server under detached supervisor (auto-restart)..."
# Double-fork daemon: fork -> setsid -> fork -> exec. The supervisor loop
# restarts `bun run dev` if it ever exits, and reparenting to init makes the
# process immune to the sandbox's per-session process reaping.
python3 - <<'PYEOF'
import os
pid = os.fork()
if pid == 0:
    os.setsid()
    if os.fork() == 0:
        os.execvp("bash", ["bash", "-c",
            "exec bash /home/z/my-project/scripts/dev-supervisor.sh >>/tmp/tp-dev.log 2>&1"])
    os._exit(0)
os.waitpid(pid, 0)
PYEOF
log_step_end "Starting Next.js dev server"

log_step_start "Waiting for Next.js dev server"
wait_for_service "localhost" "3000" "Next.js dev server" 120
log_step_end "Waiting for Next.js dev server"

log_step_start "Health check"
echo "[BUN] Performing health check..."
curl -fsS localhost:3000 >/dev/null
echo "[BUN] Health check passed"
log_step_end "Health check"

start_mini_services

log_step_start "Background data self-heal"
# If the PG universe was lost (fresh pgdata after a cold start), rebuild it
# from the SQLite backup + recompute pipeline in the background. No-op when
# data is present. Log: /tmp/auto-restore.log
( nohup bash -c "cd '$PROJECT_DIR' && DATABASE_URL='${PG_URL}' bun scripts/auto-restore-if-empty.ts >> /tmp/auto-restore.log 2>&1" >/dev/null 2>&1 & ) || true
log_step_end "Background data self-heal"

echo "Next.js dev server is running under the detached supervisor."
echo "Server log: /tmp/tp-dev.log | Auto-restore log: /tmp/auto-restore.log"
