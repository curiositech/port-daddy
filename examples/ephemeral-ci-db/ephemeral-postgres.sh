#!/usr/bin/env bash
set -euo pipefail

RUN_CONTAINER=0
if [[ "${1:-}" == "--run" ]]; then
  RUN_CONTAINER=1
fi

RUN_ID="${GITHUB_RUN_ID:-local-$(date +%s)}"
SERVICE_ID="${PD_CI_DB_SERVICE_ID:-ci:postgres:${RUN_ID}}"
CONTAINER_NAME="${PD_CI_DB_CONTAINER:-pd-ci-postgres-${RUN_ID}}"
PASSWORD="${POSTGRES_PASSWORD:-secret}"

cleanup() {
  if [[ "$RUN_CONTAINER" == "1" ]]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  pd release "$SERVICE_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[ephemeral-ci-db] claiming $SERVICE_ID"
DB_PORT="$(pd claim "$SERVICE_ID" -q)"
DATABASE_URL="postgres://postgres:${PASSWORD}@127.0.0.1:${DB_PORT}/postgres"

echo "[ephemeral-ci-db] DB_PORT=$DB_PORT"
echo "[ephemeral-ci-db] DATABASE_URL=$DATABASE_URL"

if [[ "$RUN_CONTAINER" != "1" ]]; then
  cat <<EOF
[ephemeral-ci-db] dry run; pass --run to start Docker.

docker run --name "$CONTAINER_NAME" \\
  -e POSTGRES_PASSWORD="$PASSWORD" \\
  -p "$DB_PORT:5432" \\
  -d postgres:alpine

DATABASE_URL="$DATABASE_URL" npm test
EOF
  exit 0
fi

command -v docker >/dev/null 2>&1 || {
  echo "[ephemeral-ci-db] docker is required for --run" >&2
  exit 1
}

echo "[ephemeral-ci-db] starting $CONTAINER_NAME"
docker run --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  -p "$DB_PORT:5432" \
  -d postgres:alpine >/dev/null

echo "[ephemeral-ci-db] waiting for Port Daddy service health"
pd wait "$SERVICE_ID" --timeout 60000

echo "[ephemeral-ci-db] run your tests with:"
echo "DATABASE_URL=\"$DATABASE_URL\" npm test"
