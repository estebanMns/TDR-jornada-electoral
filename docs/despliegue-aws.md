# Despliegue completo en AWS (EC2)

> **Responsable:** Jose.
> Se despliega **todo** en una sola máquina EC2 con el `docker compose` del repo: nginx (balanceador sin afinidad) + `app1…app8` (plataforma) + `actas1…actas8` (servicio de actas) + Redis. Supabase sigue en su nube (ya creado).
> Resultado: una URL `https://<tu-subdominio>.duckdns.org` con frontend y API, prendida 24/7.

---

## 0. Costo (léelo antes)

| Máquina | RAM | Precio aprox. 24/7 | Uso |
|---|---|---|---|
| **`t3.medium`** | 4 GB (+4 GB de swap) | ~US$30/mes + ~US$6 (disco e IP fija) | **Recomendada** para dejarla prendida siempre |
| `t3.large` | 8 GB | ~US$60/mes + US$6 | Si la `t3.medium` se queda corta (ver paso 8) |
| `m6i.xlarge` | 16 GB | ~US$0,19/h | Solo las horas de la prueba de carga / sustentación |

- La capa gratuita (`t3.micro`, 1 GB) **no alcanza** para 16 procesos Node + Redis.
- Con el crédito de cuenta nueva (o AWS Academy), una `t3.medium` prendida 24/7 dura varios meses.
- Si la cuenta está en el **plan gratuito** de AWS, al acabarse el crédito o vencer el plazo la cuenta se cierra a menos que se pase a plan pagado: revisen *Billing* de vez en cuando.

---

## 1. Cuenta y alerta de presupuesto (10 min)

1. **https://aws.amazon.com** → *Create an AWS account* (pide tarjeta para verificar).
2. Entra a la consola → arriba a la derecha elige la región **US East (N. Virginia) `us-east-1`** (la misma de Supabase).
3. **Alerta de presupuesto**: buscador → **Budgets → Create budget** → *Use a template* → **Monthly cost budget** → monto `40` USD → tu correo → *Create*. AWS te avisa si algo se dispara.

---

## 2. Crear la máquina (10 min)

Buscador → **EC2 → Instances → Launch instances**:

| Campo | Valor |
|---|---|
| **Name** | `preconteo` |
| **AMI** | **Ubuntu Server 24.04 LTS**, arquitectura **64-bit (x86)** |
| **Instance type** | **`t3.medium`** |
| **Key pair** | *Create new key pair* → nombre `preconteo`, tipo **ED25519**, formato **.pem** → se descarga `preconteo.pem`. **Guárdalo bien y no lo subas al repo** |
| **Network settings** → *Edit* | *Create security group* `preconteo-sg` con las reglas de abajo |
| **Storage** | **30 GiB gp3** |

Reglas de entrada del security group:

| Tipo | Puerto | Origen |
|---|---|---|
| SSH | 22 | **My IP** |
| HTTP | 80 | Anywhere (0.0.0.0/0) |
| HTTPS | 443 | Anywhere (0.0.0.0/0) |

**No** abras 6379 (Redis) ni 3000/3001 (apps). → **Launch instance**.

### 2.1 IP fija (Elastic IP)
Sin esto la IP cambia cada vez que se detiene la máquina y el dominio deja de funcionar.
1. **EC2 → Elastic IPs → Allocate Elastic IP address → Allocate**.
2. Selecciónala → **Actions → Associate Elastic IP address** → *Instance*: `preconteo` → **Associate**.
3. Anota esa IP.

### 2.2 Permisos de la llave (en tu PC, en la carpeta donde está `preconteo.pem`)
- **PowerShell (Windows):**
  ```powershell
  icacls .\preconteo.pem /inheritance:r
  icacls .\preconteo.pem /grant:r "$($env:USERNAME):(R)"
  ```
- **Git Bash / Linux / macOS:** `chmod 400 preconteo.pem`

---

## 3. Dominio gratis (DuckDNS)

1. **https://www.duckdns.org** → entrar con GitHub → crear un subdominio, por ejemplo `preconteo-ucc`.
2. En *current ip* pon la **Elastic IP** → *update ip*.
3. Comprueba en tu PC: `nslookup preconteo-ucc.duckdns.org` → debe devolver esa IP.

> En todo el documento cambia `preconteo-ucc` por tu subdominio.

---

## 4. Preparar la máquina

Entrar:
```bash
ssh -i preconteo.pem ubuntu@preconteo-ucc.duckdns.org
```
(El usuario es **`ubuntu`**. Si responde *Connection timed out*, revisa que tu IP no haya cambiado: EC2 → Security groups → `preconteo-sg` → regla SSH → *My IP*.)

Swap de 4 GB (necesaria en la `t3.medium` para compilar y correr todo):
```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Docker:
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```
Vuelve a entrar por SSH y prueba: `docker run --rm hello-world`.

---

## 5. Código y variables

### 5.1 Clonar
Si el repo es público:
```bash
git clone https://github.com/estebanMns/TDR-jornada-electoral.git ~/preconteo
```
Si es privado, con *deploy key* (solo lectura):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```
Pega esa llave en GitHub → repo → **Settings → Deploy keys → Add deploy key** (Meneses, como dueño, tiene que hacerlo o darte permiso). Luego:
```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n' >> ~/.ssh/config
git clone git@github.com:estebanMns/TDR-jornada-electoral.git ~/preconteo
```

### 5.2 Límites de red
```bash
cd ~/preconteo
sudo cp infra/sysctl/99-preconteo.conf /etc/sysctl.d/ && sudo sysctl --system
```

### 5.3 `.env`
```bash
cp .env.example .env
openssl rand -hex 32   # copia el resultado para JWT_SECRET
openssl rand -hex 16   # copia el resultado para REDIS_PASSWORD
nano .env
```
Pon estos valores (lo demás puede quedar como viene):

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | el primer valor aleatorio |
| `REDIS_URL` | `redis://redis:6379` |
| `REDIS_PASSWORD` | el segundo valor aleatorio |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | las de Supabase |
| `DOMINIO` | `preconteo-ucc.duckdns.org` (sin `https://`) |
| `PUBLIC_URL` | `https://preconteo-ucc.duckdns.org` |
| `WINDOW_MS` | `2000` |
| `SEED_JUROR_PASSWORD` | una contraseña de prueba para los jurados |

Guardar en nano: `Ctrl+O`, `Enter`, `Ctrl+X`. El `.env` **nunca** se sube al repo.

---

## 6. HTTPS (certificado gratis)

Con el puerto 80 todavía libre (antes de levantar nginx):
```bash
sudo apt -y install certbot
sudo certbot certonly --standalone -d preconteo-ucc.duckdns.org --agree-tos -m <tu-correo> -n
```
Renovación automática: `sudo crontab -e` y agrega:
```
0 4 * * 1 certbot renew --pre-hook "docker stop preconteo-nginx-1" --post-hook "docker start preconteo-nginx-1"
```

---

## 7. Levantar todo

```bash
cd ~/preconteo
docker compose -f infra/docker-compose.yml up -d --build
```
La primera vez tarda varios minutos (compila las imágenes). Luego:
```bash
docker compose -f infra/docker-compose.yml ps
```
Deben quedar `app1…app8`, `actas1…actas8` y `redis` en *healthy*, y `nginx` en *running*.

Cargar catálogo y jurados de prueba (una vez, y otra vez si Redis se borra):
```bash
docker compose -f infra/docker-compose.yml exec actas1 sh -c 'cd /repo && node --import tsx scripts/seed.ts --no-file'
```

Todo tiene `restart: unless-stopped`: si la máquina se reinicia, vuelve sola.

---

## 8. Verificar

- [ ] `https://preconteo-ucc.duckdns.org` abre desde el celular con datos móviles.
- [ ] Reparto entre instancias: `./infra/demo-instancias.sh https://preconteo-ucc.duckdns.org 16` → aparecen `app1…app8`.
- [ ] Login de jurado (`jurado0001`, contraseña `SEED_JUROR_PASSWORD`) → enviar un acta → aparece en `/resultados`.
- [ ] `docker stop preconteo-app3-1` → todo sigue → `docker start preconteo-app3-1`.
- [ ] `docker stop preconteo-redis-1` → `/api/whoami` dice `degradado` → `docker start preconteo-redis-1`.
- [ ] `sudo reboot` → al volver, todo responde sin tocar nada.
- [ ] Memoria: `free -h`. Si la swap usada pasa de ~2 GB y la página va lenta, cambia a `t3.large` (paso 10).

### URLs para entregar
| Qué | URL |
|---|---|
| Repositorio | `https://github.com/estebanMns/TDR-jornada-electoral` |
| Aplicación (frontend + API) | `https://preconteo-ucc.duckdns.org` |

---

## 9. Actualizar cuando haya cambios en `main`

Desde tu PC:
```bash
ssh -i preconteo.pem ubuntu@preconteo-ucc.duckdns.org 'cd ~/preconteo && ./infra/deploy.sh'
```
(`deploy.sh` hace `git pull` + `docker compose up -d --build` y muestra el reparto entre instancias.)

---

## 10. Cambiar el tamaño de la máquina

EC2 → instancia `preconteo` → **Instance state → Stop** → **Actions → Instance settings → Change instance type** → elegir (`t3.large`, o `m6i.xlarge` para la prueba de carga) → **Start**. La Elastic IP y todo lo instalado se conservan y los contenedores arrancan solos. Después de la prueba de carga, vuelve a la de siempre.

---

## 11. Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| `ssh`: *Connection timed out* | Cambió tu IP | Security group → regla SSH → *My IP* |
| `ssh`: *UNPROTECTED PRIVATE KEY FILE* | Permisos del `.pem` | Paso 2.2 |
| `certbot` falla | DuckDNS no apunta a la Elastic IP o el puerto 80 está cerrado/ocupado | Paso 3 y security group; `docker compose down` si nginx ya corre |
| nginx no arranca: *cannot load certificate* | `DOMINIO` mal escrito o falta el certificado | `sudo ls /etc/letsencrypt/live/` |
| El build se cae o se congela | Falta memoria | Verifica la swap (`free -h`) o usa `t3.large` |
| Una `appN` queda *unhealthy* | Redis no responde o `.env` incompleto | `docker compose -f infra/docker-compose.yml logs app1` |
| La factura sube | Quedó una máquina grande prendida | Volver a `t3.medium`; revisar *Budgets* |
| El dominio dejó de funcionar | La Elastic IP no está asociada | Paso 2.1 y actualizar DuckDNS |

---

## 12. Encendido bajo demanda (ahorro de crédito)

En lugar de dejar la instancia prendida 24/7:

- **Apagado:** `infra/aws/apagado-por-inactividad.sh` corre cada 5 min (cron de root) y detiene la instancia si en los últimos 30 min no hubo peticiones, conexiones abiertas ni SSH. Instalación, en el servidor:
  ```bash
  ( sudo crontab -l 2>/dev/null; echo "*/5 * * * * /home/ubuntu/preconteo/infra/aws/apagado-por-inactividad.sh 30" ) | sudo crontab -
  ```
- **Encendido:** la plantilla `infra/aws/encendido.yaml` crea una Lambda con URL pública. La URL de Vercel redirige a ella; si la instancia está apagada la enciende y muestra «Encendiendo el servidor…», y cuando `/api/health` responde redirige a la app con la misma ruta. Despliegue, desde tu PC:
  ```bash
  aws cloudformation deploy --stack-name preconteo-encendido --template-file infra/aws/encendido.yaml --capabilities CAPABILITY_IAM --parameter-overrides InstanceId=i-... Destino=https://HOST
  ```
- **Costo:** solo las horas encendida, más disco e IP fija (~US$5/mes). La primera visita espera 1–2 min.
- **Día de la sustentación y prueba de carga:** quitar la línea del cron (`sudo crontab -e`) y dejar la instancia prendida.

