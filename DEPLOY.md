# Desplegar Radar Tributar·IA fuera de Render

El código está en GitHub. Este proyecto necesita **Node + Chromium headless**
(buzón, RTT, honorarios) y un **volumen persistente** para los datos. Con el
`Dockerfile` incluido corre en Railway, Fly.io o un VPS.

> Importante: apunta **`DATA_DIR`** a un volumen persistente (p. ej. `/var/data`).
> Así los datos (clientes, uploads, backups) **NO se borran** en cada deploy — el
> problema que había en Render sin disco.

## Variables de entorno a configurar
Copia las que usabas en Render. Las típicas:

| Variable | Para qué |
|---|---|
| `DATA_DIR` | Ruta del volumen persistente (ej. `/var/data`). |
| `DECOLECTA_TOKEN` | Consulta RUC (decolecta). |
| `CAPSOLVER_KEY` | Resolver captcha (Turnstile del RTT). |
| `PROXY_SERVER` / `PROXY_USERNAME` / `PROXY_PASSWORD` | Proxy (opcional; el RTT ya no lo necesita). |
| `RTT_DOMINIO` | Dominio del webhook del RTT (ej. `r.radartributaria.com`). |
| `RTT_WEBHOOK_SECRET` | Secreto del webhook del RTT. |
| `SUPREMO_*` | Credenciales/nombre del usuario supremo (según auth.ts). |
| `MAX_NAVEGADORES` | Máx. navegadores simultáneos (2 por defecto). |

(Revisa el panel de Render viejo o tu `.env` para no olvidar ninguna.)

## Opción 1 — Railway (lo más parecido a Render)
1. Crea cuenta en railway.app → **New Project → Deploy from GitHub repo** → elige `hascama-blip/contaia`.
2. Railway detecta el `Dockerfile` y construye.
3. **Variables** → pega las de arriba (incluye `DATA_DIR=/var/data`).
4. **Volumes** → crea un volumen montado en `/var/data`.
5. **Settings → Networking** → genera el dominio público y luego añade tu dominio propio.

## Opción 2 — VPS (Hetzner/Contabo/Oracle) — más barato y con control
En un Ubuntu 22.04+ con Docker instalado:
```bash
git clone https://github.com/hascama-blip/contaia.git
cd contaia
docker build -t radar .
mkdir -p /var/data
docker run -d --name radar --restart unless-stopped \
  -p 80:3000 \
  -v /var/data:/var/data \
  -e DATA_DIR=/var/data \
  -e DECOLECTA_TOKEN=... \
  -e CAPSOLVER_KEY=... \
  -e RTT_DOMINIO=r.radartributaria.com \
  radar
```
(Para HTTPS pon un Caddy/Nginx delante, o usa Cloudflare.)

## DNS en Namecheap (Advanced DNS)
Cuando el host tenga IP/host público:
- **A** `@` → IP del VPS  (o **CNAME** `www` → dominio del host si usas Railway/Fly).
- **MX** `r` → `mx.sendgrid.net` (prioridad 10) — para el webhook del RTT.
- Los demás registros que ya tenías (p. ej. `app` → AWS) se dejan igual.

## Restaurar datos (si tienes un backup ZIP)
Con la app arriba, entra como Supremo → **Copia de seguridad → Restaurar desde archivo**.
Si no tienes backup, recrea los clientes (como antes en Render).
