#!/usr/bin/env bash
# Aplica una versión del sitio del Instituto Mutualista en el servidor.
# Va dentro del ZIP que descarga el código de despliegue (publicar-lightsail.sh codigo):
# lo ejecuta ese código con sudo, después de comprobar la huella SHA-256 del ZIP.
#
# Instala el sitio (instalar-lightsail.sh) y el servicio del panel de administración
# (admin-servidor.py), que publica lo que se guarda en el panel. Lo publicado desde el
# panel vive en /var/lib/instituto/contenido y un despliegue nuevo no lo toca.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
DOMINIO="__DOMINIO__"
CORREO="__CORREO__"
[ "$(id -u)" = 0 ] || { echo "Ejecuta con sudo: sudo bash $0"; exit 1; }
echo "== Instituto Mutualista · versión $(cat "$AQUI/VERSION") =="

install -m 755 "$AQUI/instalar-lightsail.sh" /usr/local/sbin/instalar-lightsail.sh

# Respaldo de la versión que estaba publicada (se guardan las 5 últimas).
if [ -f /var/www/instituto/index.html ]; then
  mkdir -p /var/backups/instituto
  tar -czf "/var/backups/instituto/sitio-$(date +%Y%m%d-%H%M%S).tar.gz" -C /var/www instituto
  ls -1t /var/backups/instituto/sitio-*.tar.gz | tail -n +6 | xargs -r rm -f
  echo "Respaldo de la versión anterior en /var/backups/instituto"
fi

# Las actualizaciones del código llegan solo con un código de despliegue.
if [ -f /etc/cron.d/instituto-web ]; then rm -f /etc/cron.d/instituto-web; echo "Sincronización automática con el bucket: desactivada."; fi

# Memoria de intercambio: convertir un video en un servidor de 512 MB necesita respaldo.
if [ -d /run/systemd/system ] && [ -z "$(swapon --show --noheadings 2>/dev/null)" ] && [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 1500000 ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Memoria de intercambio de 1 GB activada."
fi

# Panel de administración: usuario propio sin privilegios, carpetas y archivos.
id instituto-admin >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin instituto-admin
install -d -m 755 /usr/local/lib/instituto
install -m 644 "$AQUI/admin-servidor.py" /usr/local/lib/instituto/admin-servidor.py
install -m 755 "$AQUI/instituto-clave" /usr/local/sbin/instituto-clave
install -d -m 755 -o instituto-admin -g instituto-admin /var/lib/instituto /var/lib/instituto/contenido \
  /var/lib/instituto/contenido/imagenes /var/lib/instituto/contenido/videos
install -d -m 700 -o instituto-admin -g instituto-admin /var/lib/instituto/tmp /var/lib/instituto/historial /etc/instituto
ORIGENES="[\"https://$DOMINIO\", \"https://www.$DOMINIO\"]"
CFG=/etc/instituto/admin.json ORIGENES="$ORIGENES" python3 - <<'PY'
import json, os
ruta = os.environ["CFG"]
try:
    cfg = json.load(open(ruta, encoding="utf-8"))
except Exception:
    cfg = {}
cfg["origenes"] = json.loads(os.environ["ORIGENES"])
with open(ruta + ".nuevo", "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2)
os.chmod(ruta + ".nuevo", 0o600)
os.replace(ruta + ".nuevo", ruta)
PY
chown instituto-admin:instituto-admin /etc/instituto/admin.json

codigo=0
/usr/local/sbin/instalar-lightsail.sh "$AQUI/sitio.zip" "$DOMINIO" "$CORREO" || codigo=$?

if [ -d /run/systemd/system ]; then
  cat > /etc/systemd/system/instituto-admin.service <<'UNIT'
[Unit]
Description=Panel de administración del sitio del Instituto Mutualista
After=network.target

[Service]
User=instituto-admin
Group=instituto-admin
ExecStart=/usr/bin/python3 /usr/local/lib/instituto/admin-servidor.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
ReadWritePaths=/var/lib/instituto /etc/instituto
MemoryMax=450M

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --quiet instituto-admin
  systemctl restart instituto-admin
fi

# Contraseña del panel: se pide la primera vez (se escribe en la terminal, no se ve).
if ! grep -q '"hash"' /etc/instituto/admin.json; then
  echo
  echo "== Contraseña del panel de administración =="
  if { exec 3</dev/tty; } 2>/dev/null; then exec 3<&-; instituto-clave || echo "Sin contraseña todavía: créala con  sudo instituto-clave"
  else echo "Sin terminal: crea la contraseña con  sudo instituto-clave"; fi
fi
echo "$(date '+%F %T') versión $(cat "$AQUI/VERSION") aplicada (instalador: $codigo)" >> /var/log/instituto-despliegues.log

# Comprobación final desde el propio servidor.
url="http://127.0.0.1/"; extra=(-H "Host: ${DOMINIO:-localhost}")
if [ -n "$DOMINIO" ] && [ -s "/etc/letsencrypt/live/$DOMINIO/fullchain.pem" ]; then
  url="https://$DOMINIO/"; extra=(--resolve "$DOMINIO:443:127.0.0.1")
fi
sleep 1
titulo=$(curl -fsS --max-time 10 "${extra[@]}" "$url" 2>/dev/null | grep -o '<title>[^<]*</title>' | head -n1 || true)
panel=$(curl -fsS --max-time 10 "${extra[@]}" "${url}api/admin/estado" 2>/dev/null | grep -o '"servidor": *true' || true)
echo
if [ -n "$titulo" ] && [ -n "$panel" ] && [ "$codigo" = 0 ]; then
  echo "LISTO: el sitio responde en $url y el panel ya publica para todos."
elif [ -n "$titulo" ]; then
  echo "PUBLICADO CON AVISO: el sitio responde en $url, pero $( [ -z "$panel" ] && echo 'el servicio del panel no responde' || echo "el instalador avisó un problema (código $codigo)"). Lee los mensajes de arriba."
else
  echo "ERROR: el servidor no responde en $url. Lee los mensajes de arriba."; exit 1
fi
