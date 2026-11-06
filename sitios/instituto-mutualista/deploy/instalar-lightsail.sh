#!/usr/bin/env bash
# Instala o actualiza el sitio del Instituto Mutualista en un servidor AWS Lightsail
# (Linux/Unix → "OS Only" → Ubuntu 22.04 o 24.04) con Nginx.
#
# Uso (en el servidor, con el ZIP del sitio ya subido):
#   sudo bash instalar-lightsail.sh instituto-mutualista-web.zip                 # solo por IP
#   sudo bash instalar-lightsail.sh instituto-mutualista-web.zip tudominio.pe    # con dominio
#   sudo bash instalar-lightsail.sh instituto-mutualista-web.zip tudominio.pe correo@tudominio.pe
#        (con correo: además saca el certificado HTTPS gratuito de Let's Encrypt,
#         solo si el dominio ya apunta a este servidor)
#
# Para actualizar el sitio después, se vuelve a ejecutar igual con el ZIP nuevo.
# En el servidor publicado desde el bucket lo ejecuta solo actualizar-sitio.sh (cron).
set -euo pipefail

ZIP="${1:-}"
DOMINIO="${2:-}"
CORREO="${3:-}"
WEB=/var/www/instituto
CONF=/etc/nginx/sites-available/instituto

if [ "$(id -u)" -ne 0 ]; then echo "Ejecuta con sudo: sudo bash $0 $*"; exit 1; fi
if [ -z "$ZIP" ] || [ ! -f "$ZIP" ]; then echo "No encuentro el ZIP del sitio: '${ZIP}'"; exit 1; fi
DOMINIO="${DOMINIO#http://}"; DOMINIO="${DOMINIO#https://}"; DOMINIO="${DOMINIO#www.}"; DOMINIO="${DOMINIO%%/*}"
if [ -n "$DOMINIO" ] && ! [[ "$DOMINIO" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; then echo "Dominio no válido: $DOMINIO"; exit 1; fi

echo "== 1/4 Instalando Nginx =="
export DEBIAN_FRONTEND=noninteractive
if ! command -v nginx >/dev/null || ! command -v unzip >/dev/null; then
  apt-get -o DPkg::Lock::Timeout=600 update -y -q
  apt-get -o DPkg::Lock::Timeout=600 install -y -q nginx unzip
fi

echo "== 2/4 Copiando el sitio =="
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unzip -q -o "$ZIP" -d "$TMP"
# Acepta el ZIP con los archivos sueltos o dentro de una carpeta.
SRC="$TMP"
if [ ! -f "$SRC/index.html" ]; then
  SRC=$(dirname "$(find "$TMP" -maxdepth 3 -name index.html | head -n1)")
fi
if [ ! -f "$SRC/index.html" ]; then echo "El ZIP no tiene index.html"; exit 1; fi
mkdir -p "$WEB"
find "$WEB" -mindepth 1 -delete
cp -r "$SRC"/. "$WEB"/
rm -f "$WEB/README.md"; rm -rf "$WEB/deploy"
chown -R www-data:www-data "$WEB"
find "$WEB" -type d -exec chmod 755 {} +
find "$WEB" -type f -exec chmod 644 {} +

echo "== 3/4 Configurando Nginx =="
if [ -n "$DOMINIO" ]; then NOMBRES="$DOMINIO www.$DOMINIO"; else NOMBRES="_"; fi
# IPv6 solo si el servidor lo tiene activo (en Lightsail se puede desactivar).
if [ -s /proc/net/if_inet6 ]; then LISTEN6="listen [::]:80 default_server;"; else LISTEN6=""; fi
# Si certbot ya agregó HTTPS a esta configuración, no se reescribe (solo se actualizan los archivos).
if [ -f "$CONF" ] && grep -q "managed by Certbot" "$CONF" && grep -q "server_name $NOMBRES;" "$CONF"; then
  echo "Configuración con HTTPS ya existente: se conserva."
else
  cat > "$CONF" <<EOF
server {
    listen 80 default_server;
    $LISTEN6
    server_name $NOMBRES;
    root $WEB;
    index index.html;
    charset utf-8;

    location / { try_files \$uri \$uri/ =404; }
    # El contenido editable cambia a menudo: que el navegador siempre pida la versión nueva.
    location = /sitio.json { add_header Cache-Control "no-cache"; }
    location = /index.html { add_header Cache-Control "no-cache"; }
    location ~* \.(png|jpe?g|webp|gif|svg|ico|mp4|webm)\$ { expires 7d; add_header Cache-Control "public"; }
    location ~ /\. { deny all; }

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
EOF
fi
ln -sf "$CONF" /etc/nginx/sites-enabled/instituto
rm -f /etc/nginx/sites-enabled/default
nginx -t
if [ -d /run/systemd/system ]; then
  systemctl enable --now nginx >/dev/null
  systemctl reload nginx
else
  nginx -s reload 2>/dev/null || nginx
fi

echo "== 4/4 HTTPS =="
IP="${IP_PUBLICA:-}"   # el actualizador la pasa; si no, se consulta
[ -n "$IP" ] || IP=$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)
if [ -z "$DOMINIO" ]; then
  echo "Sin dominio: el sitio queda en http://${IP:-IP-DEL-SERVIDOR}"
elif [ -z "$CORREO" ]; then
  echo "Sitio listo en http://$DOMINIO (cuando el DNS apunte a ${IP:-este servidor})."
  echo "Para HTTPS, vuelve a ejecutar agregando tu correo al final."
else
  resuelve() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}' || true; }
  D1=$(resuelve "$DOMINIO"); D2=$(resuelve "www.$DOMINIO")
  if [ -z "$IP" ] || [ "$D1" != "$IP" ]; then
    echo "Todavía no: $DOMINIO apunta a '${D1:-nada}' y este servidor es '${IP:-?}'."
    echo "Crea en tu DNS un registro A de '@' hacia $IP, espera unos minutos y vuelve a ejecutar."
  else
    apt-get -o DPkg::Lock::Timeout=600 install -y -q certbot python3-certbot-nginx >/dev/null
    DOMS=(-d "$DOMINIO")
    if [ "$D2" = "$IP" ]; then DOMS+=(-d "www.$DOMINIO"); else echo "Aviso: www.$DOMINIO aún no apunta aquí; el certificado será solo para $DOMINIO."; fi
    certbot --nginx "${DOMS[@]}" --non-interactive --agree-tos --no-eff-email -m "$CORREO" --redirect --expand --keep-until-expiring
    echo "Listo: https://$DOMINIO (el certificado se renueva solo)."
  fi
fi
