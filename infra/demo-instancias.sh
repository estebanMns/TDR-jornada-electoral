#!/usr/bin/env bash
# RT-1 / RT-2: muestra que nginx reparte sin afinidad (cada petición puede caer en otra instancia).
#   ./infra/demo-instancias.sh https://preconteo-xxx.duckdns.org 16
set -euo pipefail
URL="${1:-http://localhost:8080}"
N="${2:-16}"

for _ in $(seq 1 "$N"); do
  curl -s -D - -o /dev/null "$URL/api/whoami" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-instance"{print $2}'
done | sort | uniq -c | sort -k2 -V
