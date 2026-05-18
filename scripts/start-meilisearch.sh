#!/usr/bin/env sh
set -eu

MEILI_NAME="${MEILI_NAME:-meilisearch}"
MEILI_IMAGE="${MEILI_IMAGE:-getmeili/meilisearch:v1.6}"
MEILI_PORT="${MEILI_PORT:-7700}"
MEILI_KEY="${MEILI_MASTER_KEY:-changeme-dev-key}"
MEILI_VOLUME="${MEILI_VOLUME:-meili-data}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[search:up] Docker nie je nainstalovany. Preskakujem spustenie Meilisearch." >&2
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "[search:up] Docker daemon nebezi. Preskakujem spustenie Meilisearch." >&2
  exit 0
fi

if docker ps --format '{{.Names}}' | grep -Fxq "$MEILI_NAME"; then
  exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$MEILI_NAME"; then
  docker start "$MEILI_NAME" >/dev/null || true
  exit 0
fi

docker volume create "$MEILI_VOLUME" >/dev/null 2>&1 || true

docker run -d \
  --name "$MEILI_NAME" \
  --restart unless-stopped \
  -p "${MEILI_PORT}:7700" \
  -e MEILI_NO_ANALYTICS=true \
  -e MEILI_MASTER_KEY="$MEILI_KEY" \
  -v "${MEILI_VOLUME}:/meili_data" \
  "$MEILI_IMAGE" >/dev/null || true
