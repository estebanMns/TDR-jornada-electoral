# Despliegue (RT-1, RT-10)

Una VM con Docker Compose: `nginx` (con la PWA del jurado) + `app1…app8` (plataforma Next.js) + `actas1…actas8` (servicio de actas) + `redis`. Supabase va en su nube.

| Ruta | Va a | Imagen |
|---|---|---|
| `/api/actas…` | `actas1…actas8` (upstream `actas`, sin afinidad) | `infra/Dockerfile.actas` |
| `/jurado/` | archivos estáticos dentro de nginx | `infra/Dockerfile.nginx` |
| todo lo demás (`/login`, `/verificacion`, `/api/…`, `/ws/`) | `app1…app8` (upstream `preconteo`) | `infra/Dockerfile` |

Cada `appN` reenvía las decisiones de auditoría a su `actasN` (`ACTAS_URL`, ya puesto en el compose).
La prueba de carga corre **desde otra máquina**.

## Decisiones

| Pregunta | Decisión | Por qué |
|---|---|---|
| Nube | Azure for Students (alternativas: GCP, DigitalOcean) | Crédito gratis; cualquier VM Linux sirve porque todo va en Compose |
| VM | 4 vCPU / 8–16 GB, Ubuntu 24.04 (`Standard_D4s_v5` o `B4ms`) | 8 procesos Node + Redis + nginx; 20.000–50.000 conexiones SSE |
| Instancias | 8 en **una** VM, detrás de nginx sin afinidad | El caso pide 8 instancias tras un balanceador, no 8 máquinas |
| Dominio | DuckDNS (`preconteo-xxx.duckdns.org`) → IP estática | Necesario para el certificado |
| HTTPS | Let's Encrypt (`certbot --standalone`) | PWA, cámara y `crypto.subtle` exigen contexto seguro |
| Supabase | Plan gratuito en `us-east-1` | Cerca de una VM en East US |
| Frontend | Lo sirve Next en cada instancia; nginx cachea `/_next/static` | Con Next no hay build estático aparte que copiar a nginx |
| Actualización | `infra/deploy.sh` (`git pull` + `compose up -d --build`) | Simple y reproducible |

## 1. Supabase (una vez)

1. Crear el proyecto y guardar `Project URL` y la clave **service_role** (solo en `.env` del servidor; nunca en el repo ni en el frontend).
2. Ejecutar las migraciones en orden (`001_*`, `010_*`, `020_*`) en el SQL Editor o con `supabase db push`. La `010` crea el bucket **privado** `actas-fotos`.
3. El seed (catálogo + 6.400 jurados) se corre **después de levantar** el compose, ver §6: necesita el Redis de la VM, que no expone puertos.

## 2. VM

1. Ubuntu 24.04, **IP pública estática**, acceso solo por llave SSH.
2. Reglas de entrada: 22 (solo IPs del grupo), 80 y 443. **No** exponer 6379 ni 3000.
3. Apuntar el subdominio de DuckDNS a la IP.

## 3. Sistema

```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER          # salir y volver a entrar
sudo cp infra/sysctl/99-preconteo.conf /etc/sysctl.d/ && sudo sysctl --system
```

Los `ulimits` (200.000 descriptores) ya están en el compose; nginx usa `worker_rlimit_nofile 200000` y `worker_connections 65535`.

## 4. Código y variables

```bash
git clone <url-del-repo> preconteo && cd preconteo
cp .env.example .env
```

Mínimo en `.env`: `JWT_SECRET` (`openssl rand -hex 32`; **mínimo 32 caracteres**, lo comparten la plataforma y el servicio de actas), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `REDIS_URL=redis://redis:6379`, `REDIS_PASSWORD` (aleatorio), `WINDOW_MS=2000`, `DOMINIO=preconteo-xxx.duckdns.org`, `PUBLIC_URL=https://preconteo-xxx.duckdns.org`, `NODE_ENV=production`, `SEED_JUROR_PASSWORD` (contraseña de prueba de los jurados).
Redis arranca con `--requirepass` y sin `ports:` (solo red interna de Docker).

## 5. HTTPS

Con el puerto 80 libre (antes de levantar nginx):

```bash
sudo apt -y install certbot
sudo certbot certonly --standalone -d preconteo-xxx.duckdns.org
```

`/etc/letsencrypt` se monta de solo lectura en nginx; el puerto 80 redirige a 443.
Renovación semanal (cron de root):

```
0 4 * * 1 certbot renew --pre-hook "docker compose -f /home/<usuario>/preconteo/infra/docker-compose.yml stop nginx" --post-hook "docker compose -f /home/<usuario>/preconteo/infra/docker-compose.yml start nginx"
```

## 6. Levantar

```bash
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml ps        # 8 apps + 8 actas + redis "healthy", nginx "running"

# Una vez (y cada vez que se reinicie Redis desde cero): catálogo en Redis y Supabase + jurados
docker compose -f infra/docker-compose.yml exec actas1 sh -c 'cd /repo && node --import tsx scripts/seed.ts --no-file'
```

- Todo con `restart: unless-stopped` → si la VM reinicia, vuelve solo (RT-10).
- Cada `appN` y `actasN` tiene `healthcheck` a `/api/health` (503 si Redis no responde).
- `stop_grace_period: 15s` → apagado ordenado: SSE recibe `event: reconectar`, WS se cierra con 1012.
- Actualizar: `./infra/deploy.sh`.

## 7. Verificación después de cada despliegue

- [ ] `https://<dominio>/resultados` abre desde un celular con datos móviles.
- [ ] Reparto sin afinidad: `./infra/demo-instancias.sh https://<dominio> 16` → aparecen `app1…app8`.
- [ ] Login de jurado (`jurado0001`…, contraseña `SEED_JUROR_PASSWORD`) → `/jurado/`, envío de un acta y su aparición en `/resultados`.
- [ ] Un acta dudosa aparece en `/verificacion`; al aprobarla, el acumulado cambia.
- [ ] Dos auditores en navegadores distintos se ven en vivo (o `pnpm smoke` con `URL_A=URL_B=https://<dominio>`).
- [ ] `/ops` muestra las 8 instancias.
- [ ] `docker stop preconteo-app3-1` → el sistema sigue y `/ops` lo refleja; `docker start` lo devuelve.
- [ ] `docker stop preconteo-redis-1` → `/api/whoami` dice `degradado`, la consola deshabilita acciones; al volver, se recupera sola.
- [ ] Reiniciar la VM → todo vuelve sin tocar nada.

## 8. Día de la sustentación

- Desplegar la versión final **el día antes** y no tocar nada después.
- Correr `loadtest/` desde otra máquina (con Evelyn). Tener a mano `docker stop preconteo-app3-1` y `docker stop preconteo-redis-1` para RF-10.
- Revisar crédito de la nube y vigencia del certificado.
- Apagar la VM después de la entrega.
