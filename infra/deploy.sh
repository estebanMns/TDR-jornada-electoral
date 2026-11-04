#!/usr/bin/env bash
# Actualiza la VM con la última versión de main (GENERAL §13).
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f infra/docker-compose.yml"

git pull --ff-only
$COMPOSE up -d --build --remove-orphans
$COMPOSE ps

echo
echo "Reparto entre instancias (debe mostrar varias appN):"
./infra/demo-instancias.sh "${PUBLIC_URL:-http://localhost}" 16
