# Meneses — Despliegue paso a paso

> **Este documento es todo lo que necesitas para desplegar**: no hace falta que el resto del desarrollo esté listo.
>
> **Qué despliegas tú:** backend (8 instancias), frontend (lo sirve nginx en el mismo dominio), nginx como balanceador y Redis. Todo va en **una instancia EC2 de AWS** con Docker Compose.
> **Qué no despliegas:** Supabase. Es un servicio en la nube que **ya creó Jose**; tú solo pones sus dos claves en el `.env` del servidor.
>
> **Idea:** desplegar **desde el primer día** un *esqueleto* (una página web vacía + un backend que solo responde `whoami`/`health`) con toda la infraestructura real: 8 instancias, nginx sin afinidad, Redis y HTTPS. Después, cada vez que algo se integra en `main`, se vuelve a desplegar con un comando. Así el despliegue no se deja para el final, que es cuando todo falla.
>
> Cubre RT-1 (8 instancias detrás de un balanceador), RT-2 (sin afinidad) y RT-10 (URL pública que funciona sin intervención).

---

## 0. Lo que necesitas antes de empezar

| Qué | Dónde |
|---|---|
| Cuenta de **AWS** | aws.amazon.com → *Create account* (pide tarjeta para verificar). Las cuentas nuevas traen crédito de prueba; si la universidad tiene **AWS Academy / AWS Educate**, úsenlo |
| Acceso de escritura al repo de GitHub | El dueño del repo te invita |
| Cuenta en **DuckDNS** (dominio gratis) | duckdns.org — entrar con GitHub |
| Las variables de Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) | ✅ **Ya te las pasó Jose.** Guárdalas solo en el `.env` de la VM (paso 5); nunca en el repo ni en el frontend |

> 💸 **Cuidado con el costo.** Una instancia de 4 vCPU prendida todo el mes cuesta ~US$120–140. Plan:
> - Mientras desarrollan: **`t3.medium`** (2 vCPU / 4 GB, ~US$0,04/h ≈ US$30/mes) y **detenerla (*Stop*) cuando no la usen**.
> - Para la prueba de carga y la sustentación: cambiarla a **`m6i.xlarge`** (4 vCPU / 16 GB, ~US$0,19/h) solo esas horas.
> - Una instancia detenida no cobra cómputo; sí cobra el disco (~US$2/mes por 20 GB) y la Elastic IP (~US$3,6/mes).
> - **Lo primero que haces:** crear una alerta de presupuesto (paso 1.0).

---

## 1. Crear la instancia EC2

### 1.0 Alerta de presupuesto (2 minutos, evita sustos)
Consola de AWS → **Billing and Cost Management → Budgets → Create budget** → *Use a template* → **Monthly cost budget** → monto `20` USD → tu correo. AWS te avisa al acercarse al límite.

### 1.1 Región
Arriba a la derecha, elige **US East (N. Virginia) `us-east-1`** — la misma región del proyecto de Supabase, para que la latencia entre servidor y base sea mínima.

### 1.2 Lanzar la instancia
Consola → **EC2 → Instances → Launch instances**:
1. **Name:** `preconteo`.
2. **AMI:** *Ubuntu Server 24.04 LTS (HVM), SSD Volume Type*, arquitectura **64-bit (x86)**.
3. **Instance type:** `t3.medium`.
4. **Key pair:** *Create new key pair* → nombre `preconteo`, tipo **ED25519**, formato **.pem** → se descarga `preconteo.pem`. **Guárdalo bien: sin él no entras.** No lo subas al repo.
5. **Network settings → Edit → Create security group** `preconteo-sg` con estas reglas de entrada:
   | Tipo | Puerto | Origen |
   |---|---|---|
   | SSH | 22 | **My IP** (solo tu IP; si cambias de red, actualízala) |
   | HTTP | 80 | Anywhere (0.0.0.0/0) |
   | HTTPS | 443 | Anywhere (0.0.0.0/0) |
   Redis (6379) y las apps (3000) **no** se abren.
6. **Storage:** `20 GiB` **gp3**.
7. **Launch instance**.

### 1.3 IP fija (Elastic IP)
Sin esto la IP pública cambia cada vez que detienes la instancia y el dominio deja de funcionar.
1. **EC2 → Network & Security → Elastic IPs → Allocate Elastic IP address → Allocate**.
2. Selecciónala → **Actions → Associate Elastic IP address** → *Instance*: `preconteo` → **Associate**.
3. Anota esa IP.

### 1.4 Permisos de la llave (en tu PC)
- **Linux / macOS / Git Bash:** `chmod 400 preconteo.pem`
- **Windows (PowerShell):**
  ```powershell
  icacls .\preconteo.pem /inheritance:r
  icacls .\preconteo.pem /grant:r "$($env:USERNAME):(R)"
  ```

## 2. Dominio con DuckDNS
1. En duckdns.org crea un subdominio, por ejemplo `preconteo-ucc` → queda `preconteo-ucc.duckdns.org`.
2. Pon la **Elastic IP** y dale *update ip*.
3. Comprueba desde tu PC: `nslookup preconteo-ucc.duckdns.org` debe devolver esa IP. (`ping` no responde porque el security group no permite ICMP; es normal.)

## 3. Preparar la instancia
```bash
ssh -i preconteo.pem ubuntu@preconteo-ucc.duckdns.org
```
El usuario de las imágenes Ubuntu en AWS es **`ubuntu`**.

Swap de 4 GB (útil en la `t3.medium` para compilar las imágenes de Docker sin quedarse sin memoria):
```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit   # salir y volver a entrar para que aplique el grupo docker
```
Límites del sistema para muchas conexiones:
```bash
sudo tee /etc/sysctl.d/99-preconteo.conf > /dev/null <<'EOF'
fs.file-max = 1000000
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
EOF
sudo sysctl --system
```

### Clonar el repo (si es privado, con *deploy key*)
```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```
Pega esa llave en GitHub → repo → **Settings → Deploy keys → Add** (solo lectura). Luego:
```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
EOF
git clone git@github.com:<usuario>/<repo>.git ~/preconteo
```

---

## 4. Archivos del esqueleto (súbelos al repo desde tu PC)

Si el monorepo todavía no existe, estos son los archivos mínimos. Cuando los demás agreguen sus módulos, **estos archivos no cambian**: solo crece el código dentro de `apps/`.

### 4.1 Raíz
`package.json`
```json
{
  "name": "preconteo",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build"
  }
}
```
`pnpm-workspace.yaml`
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "loadtest"
```
`.dockerignore`
```
**/node_modules
**/dist
.env
.git
```
`.gitignore`
```
node_modules
dist
.env
```
`.env.example` (se sube al repo **sin** valores secretos)
```
DOMAIN=preconteo-ucc.duckdns.org
JWT_SECRET=cambiar
REDIS_PASSWORD=cambiar
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
WINDOW_MS=2000
```

### 4.2 Backend mínimo — `apps/server`
`apps/server/package.json`
```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js"
  },
  "dependencies": { "fastify": "^5.0.0", "ioredis": "^5.4.0" },
  "devDependencies": { "typescript": "^5.6.0", "tsx": "^4.19.0", "@types/node": "^22.0.0" }
}
```
`apps/server/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "outDir": "dist", "rootDir": "src", "strict": true, "esModuleInterop": true, "skipLibCheck": true
  },
  "include": ["src"]
}
```
`apps/server/src/main.ts`
```ts
import Fastify from "fastify";
import { Redis } from "ioredis";

const INSTANCE_ID = process.env.INSTANCE_ID ?? "local";
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  enableOfflineQueue: false, // fallar rápido si Redis no está (RF-10)
  maxRetriesPerRequest: 1,
  commandTimeout: 500,
});
redis.on("error", () => {}); // el estado se consulta con ping; evita logs infinitos

const app = Fastify({ logger: true });

app.addHook("onSend", async (_req, reply) => {
  reply.header("X-Instance", INSTANCE_ID);
});

async function redisOk() {
  try { return (await redis.ping()) === "PONG"; } catch { return false; }
}

app.get("/api/whoami", async () => ({
  instancia: INSTANCE_ID,
  redis: (await redisOk()) ? "ok" : "degradado",
}));

app.get("/api/health", async (_req, reply) =>
  (await redisOk()) ? { ok: true } : reply.code(503).send({ ok: false }),
);

const close = async () => { await app.close(); redis.disconnect(); process.exit(0); };
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });
```

### 4.3 Frontend mínimo — `apps/web`
Desde la raíz, en tu PC:
```bash
pnpm create vite apps/web --template react-ts
```
En `apps/web/package.json` cambia `"name"` a `"web"`. (Evelyn luego le pone Tailwind/shadcn; para el despliegue basta con que `pnpm --filter web build` genere `apps/web/dist`.)

Luego, en la raíz: `pnpm install` (genera `pnpm-lock.yaml`, **súbelo al repo**).

### 4.4 Infraestructura — `infra/`
`infra/Dockerfile.server`
```dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter "server..." build
WORKDIR /repo/apps/server
ENV NODE_ENV=production
CMD ["node", "--max-old-space-size=1024", "dist/main.js"]
```
`infra/Dockerfile.nginx` (compila el frontend y lo sirve nginx)
```dockerfile
FROM node:22-alpine AS web
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter "web..." build

FROM nginx:1.28-alpine
COPY infra/nginx.conf /etc/nginx/nginx.conf
COPY infra/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web /repo/apps/web/dist /usr/share/nginx/html
```
`infra/nginx.conf`
```nginx
worker_processes auto;
worker_rlimit_nofile 200000;
events { worker_connections 65535; }

http {
  include       /etc/nginx/mime.types;
  sendfile      on;
  keepalive_timeout 65;
  include /etc/nginx/conf.d/*.conf;
}
```
`infra/default.conf.template` (nginx reemplaza `${DOMAIN}` al arrancar; las variables `$host`, etc. no se tocan)
```nginx
resolver 127.0.0.11 valid=10s;   # DNS interno de Docker

upstream app {
  zone app 64k;
  # round-robin: SIN ip_hash / hash / sticky (RT-2)
  server app1:3000 resolve max_fails=1 fail_timeout=5s;
  server app2:3000 resolve max_fails=1 fail_timeout=5s;
  server app3:3000 resolve max_fails=1 fail_timeout=5s;
  server app4:3000 resolve max_fails=1 fail_timeout=5s;
  server app5:3000 resolve max_fails=1 fail_timeout=5s;
  server app6:3000 resolve max_fails=1 fail_timeout=5s;
  server app7:3000 resolve max_fails=1 fail_timeout=5s;
  server app8:3000 resolve max_fails=1 fail_timeout=5s;
  keepalive 256;
}

map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
  listen 80;
  server_name ${DOMAIN};
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  http2 on;
  server_name ${DOMAIN};
  ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

  # SSE (público y ops): sin buffer, conexiones largas
  location ~ ^/api/(publico|ops)/stream {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
  }

  # WebSocket de verificación
  location /ws/ {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 1h;
  }

  # API normal
  location /api/ {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_next_upstream error timeout http_502;   # si una instancia cae, prueba otra
    client_max_body_size 10m;                     # fotos de actas
  }

  # Frontend (SPA)
  location / {
    root /usr/share/nginx/html;
    try_files $uri /index.html;
  }
}
```
> ⚠️ `proxy_next_upstream` reintenta solo errores de conexión; un `POST /api/actas` no se reenvía dos veces gracias a la idempotencia de todos modos.

`infra/redis.conf`
```
appendonly yes
appendfsync everysec
maxmemory 1gb
maxmemory-policy noeviction
```
`infra/docker-compose.yml`
```yaml
x-app: &app
  build: { context: .., dockerfile: infra/Dockerfile.server }
  image: preconteo-server
  restart: unless-stopped
  env_file: ../.env
  environment: &app-env
    REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
    PORT: "3000"
  ulimits: { nofile: { soft: 200000, hard: 200000 } }
  depends_on: [redis]
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
    interval: 10s
    timeout: 3s
    retries: 3

services:
  redis:
    image: redis:7.4-alpine
    restart: unless-stopped
    command: ["redis-server", "/usr/local/etc/redis/redis.conf", "--requirepass", "${REDIS_PASSWORD}"]
    volumes:
      - ./redis.conf:/usr/local/etc/redis/redis.conf:ro
      - redis-data:/data
    # sin "ports": Redis NO se expone a internet

  app1: { <<: *app, environment: { <<: *app-env, INSTANCE_ID: app1 } }
  app2: { <<: *app, environment: { <<: *app-env, INSTANCE_ID: app2 } }
  app3: { <<: *app, environment: { <<: *app-env, INSTANCE_ID: app3 } }
  app4: { <<: *app, environment: { <<: *app-env, INSTANCE_ID: app4 } }
  app5: { <<: *app, environment: { <<: *app-env, INSTANCE_ID: app5 } }
  app6: { <<: *app, environment: { <<: *app-env, INSTANCE_ID: app6 } }
  app7: { <<: *app, environment: { <<: *app-env, INSTANCE_ID: app7 } }
  app8: { <<: *app, environment: { <<: *app-env, INSTANCE_ID: app8 } }

  nginx:
    build: { context: .., dockerfile: infra/Dockerfile.nginx }
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
    ulimits: { nofile: { soft: 200000, hard: 200000 } }
    depends_on: [app1, app2, app3, app4, app5, app6, app7, app8]

volumes:
  redis-data:
```
> Las 8 apps usan **la misma imagen** (`preconteo-server`): se construye una vez.

`infra/deploy.sh`
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
DC="docker compose --project-name preconteo --env-file .env -f infra/docker-compose.yml"
$DC up -d --build
docker image prune -f
$DC ps
```
(`chmod +x infra/deploy.sh` antes de subirlo, o córrelo con `bash infra/deploy.sh`.)

---

## 5. Primer despliegue en la VM

```bash
cd ~/preconteo
cp .env.example .env
nano .env
```
Llénalo: `DOMAIN` (tu subdominio), `JWT_SECRET` y `REDIS_PASSWORD` con valores aleatorios (`openssl rand -hex 32`), y las dos variables de Supabase que te pasó Jose.

### Certificado HTTPS (una vez, con el puerto 80 libre)
```bash
sudo apt -y install certbot
sudo certbot certonly --standalone -d preconteo-ucc.duckdns.org --agree-tos -m <tu-correo> -n
```
Renovación automática (los certificados duran 90 días):
```bash
sudo crontab -e
```
```
0 4 * * 1 certbot renew --pre-hook "docker stop preconteo-nginx-1" --post-hook "docker start preconteo-nginx-1"
```
(`deploy.sh` usa `--project-name preconteo`, por eso los contenedores se llaman `preconteo-nginx-1`, `preconteo-app3-1`, etc. Compruébalo con `docker ps`.)

### Levantar
```bash
bash infra/deploy.sh
```
La primera vez tarda unos minutos (construye las imágenes). Al final debes ver `redis`, `app1…app8` y `nginx` en estado `running` / `healthy`.
---

## 6. Verificación (hazla después de cada despliegue)

- [ ] `https://preconteo-ucc.duckdns.org` abre (página de Vite por ahora) desde el celular con datos móviles.
- [ ] **Reparto sin afinidad (RT-1/RT-2)**:
  ```bash
  for i in $(seq 1 16); do curl -s https://preconteo-ucc.duckdns.org/api/whoami; echo; done
  ```
  Deben aparecer `app1` … `app8` y `"redis":"ok"`.
- [ ] **Caída de una instancia**: `docker stop preconteo-app3-1` → el `curl` en bucle sigue respondiendo con las otras 7 → `docker start preconteo-app3-1`.
- [ ] **Redis caído (RF-10)**: `docker stop preconteo-redis-1` → `whoami` dice `"redis":"degradado"` y `/api/health` da 503 → `docker start preconteo-redis-1`.
- [ ] **Reinicio de la VM** (RT-10): `sudo reboot` → al volver, todo responde sin tocar nada.

---

## 7. Despliegues siguientes

Cada vez que se integra algo en `main`:
```bash
ssh -i preconteo.pem ubuntu@preconteo-ucc.duckdns.org 'bash ~/preconteo/infra/deploy.sh'
```

### Opcional: despliegue automático con GitHub Actions
En el repo: *Settings → Secrets and variables → Actions* → crear `VM_HOST` (el dominio), `VM_USER` (`ubuntu`) y `VM_SSH_KEY` (una llave privada **nueva**, creada con `ssh-keygen -t ed25519 -f deploy_gh -N ""`, cuya pública agregas a `~/.ssh/authorized_keys` de la instancia). Ojo: el security group solo deja SSH desde tu IP; para que GitHub Actions entre tendrías que abrir el 22 a todo internet — si no quieres hacerlo, despliega a mano con el comando de arriba.

`.github/workflows/deploy.yml`
```yaml
name: deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.VM_HOST }}
          username: ${{ secrets.VM_USER }}
          key: ${{ secrets.VM_SSH_KEY }}
          script: bash ~/preconteo/infra/deploy.sh
```
Si la VM está apagada, el workflow falla: es normal, se vuelve a correr cuando la prendan.

---

## 8. Cómo lo usan los demás mientras desarrollan

- **En local** nadie necesita las 8 instancias: `docker run -d -p 6379:6379 redis:7.4-alpine` y `pnpm dev`. Para probar con varias instancias, el mismo `docker compose` sirve en local quitando el bloque HTTPS (o con un `infra/docker-compose.local.yml` que solo levante redis + 2 apps + nginx en el puerto 8080).
- **Cuando agreguen variables nuevas** (`.env`), deben agregarlas a `.env.example` y avisarte para que las pongas en la VM.
- **Cuando agreguen rutas nuevas**: si empiezan por `/api/` o `/ws/` ya pasan por nginx; si es un stream SSE nuevo, avísales que debe ir bajo `/api/publico/stream` u `/api/ops/stream` o hay que agregarlo al bloque sin buffer.

---

## 9. Antes de la sustentación

- [ ] Cambiar la instancia a **`m6i.xlarge`** (4 vCPU / 16 GB): EC2 → instancia → **Instance state → Stop** → **Actions → Instance settings → Change instance type** → `m6i.xlarge` → **Start**. La Elastic IP se mantiene. Al terminar, volver a `t3.medium`.
- [ ] Desplegar la versión final **el día antes** y no tocar nada más.
- [ ] Lanzar una segunda instancia (`c6i.large` o `t3.large`, misma región, mismo procedimiento sin Elastic IP) para correr `loadtest/` — **nunca** desde la misma instancia. Coordinar con Evelyn. Terminarla (*Terminate*) después.
- [ ] Revisar el gasto en *Billing* y la fecha de vencimiento del certificado (`sudo certbot certificates`).
- [ ] Tener a mano: `docker stop preconteo-app3-1` (caída de instancia) y `docker stop preconteo-redis-1` (Redis caído).
- [ ] Después de la entrega: **detener** la instancia; cuando ya no la necesiten, **terminarla y liberar la Elastic IP** (*Elastic IPs → Release*) para que no siga cobrando.

---

## 10. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `certbot` falla | El puerto 80 está ocupado o el DNS no apunta aún | `docker compose down` y revisar `ping` del dominio |
| nginx no arranca: *cannot load certificate* | Falta el certificado o `DOMAIN` mal escrito en `.env` | Revisar `ls /etc/letsencrypt/live/` |
| nginx no arranca: *invalid parameter "resolve"* | Imagen de nginx vieja | Usar `nginx:1.28-alpine` o superior |
| `whoami` siempre da la misma instancia | Se usa `curl` con keep-alive desde el navegador | Probar con `curl` en bucle (cada uno abre conexión nueva) |
| Los SSE llegan en bloques o con retraso | Falta `proxy_buffering off` en esa ruta | Revisar el `location` de streams |
| `pnpm install --frozen-lockfile` falla en Docker | No se subió `pnpm-lock.yaml` actualizado | Correr `pnpm install` en local y subir el lock |
| La factura sube | La instancia quedó prendida o se cambió a `m6i.xlarge` y no se devolvió | Detenerla siempre que no se use; revisar *Budgets* |
| `ssh` dice *Connection timed out* | Cambió tu IP pública y el security group solo permite la anterior | EC2 → Security groups → `preconteo-sg` → editar regla SSH → *My IP* |
| `ssh` dice *UNPROTECTED PRIVATE KEY FILE* | Permisos del `.pem` muy abiertos | Paso 1.4 |
| El dominio dejó de funcionar tras detener la instancia | No se asoció la Elastic IP | Paso 1.3 y actualizar DuckDNS |
