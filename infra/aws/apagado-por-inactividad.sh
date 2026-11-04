#!/usr/bin/env bash
# Apaga la instancia si nadie la usó en los últimos MIN minutos (30 por defecto).
# La instancia queda DETENIDA (no se borra) y la vuelve a encender la Lambda de
# infra/aws/encendido.yaml cuando alguien abre la URL pública.
#
# Instalar (root, cada 5 minutos):
#   ( sudo crontab -l 2>/dev/null; echo "*/5 * * * * /home/ubuntu/preconteo/infra/aws/apagado-por-inactividad.sh 30" ) | sudo crontab -
# Desactivar (p. ej. el día de la sustentación): quitar esa línea con `sudo crontab -e`.
set -euo pipefail

MIN="${1:-30}"
NGINX="${NGINX_CONTENEDOR:-preconteo-nginx-1}"

# Recién encendida: dar tiempo a que llegue la primera visita.
uptime_s="$(cut -d. -f1 /proc/uptime)"
[ "$uptime_s" -lt $((MIN * 60)) ] && exit 0

# Alguien con la página abierta (SSE/WS mantienen la conexión) o conectado por SSH.
conexiones="$(ss -Htn state established '( sport = :443 or sport = :80 or sport = :22 )' | wc -l)"
[ "$conexiones" -gt 0 ] && exit 0

# Peticiones atendidas por nginx en la ventana.
# Si docker falla se cuenta como actividad: ante la duda, no apagar.
peticiones="$( (docker logs --since "${MIN}m" "$NGINX" 2>&1 || echo error) | wc -l)"
[ "$peticiones" -gt 0 ] && exit 0

logger -t mesa-a-mesa "sin visitas en ${MIN} min: apagando la instancia"
/sbin/shutdown -h now
