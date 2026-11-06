#!/usr/bin/env bash
# Instala o actualiza el sitio del Instituto Mutualista en un servidor AWS Lightsail
# (Ubuntu 22.04 o 24.04) con Nginx y, con dominio y correo, HTTPS de Let's Encrypt.
#
# Normalmente lo ejecuta aplicar.sh, dentro del código de despliegue
# (publicar-lightsail.sh codigo). A mano, como root:
#   bash instalar-lightsail.sh sitio.zip                         # solo por IP
#   bash instalar-lightsail.sh sitio.zip tudominio.pe            # con dominio, por http
#   bash instalar-lightsail.sh sitio.zip tudominio.pe tu@correo  # + certificado HTTPS
#
# La configuración de Nginx se genera completa en cada ejecución (también la parte HTTPS):
# certbot solo obtiene y renueva el certificado (modo webroot) y no la edita.
set -euo pipefail

ZIP="${1:-}"
DOMINIO="${2:-}"
CORREO="${3:-}"
WEB=/var/www/instituto
CONF=/etc/nginx/sites-available/instituto
SEG=/etc/nginx/snippets/instituto-seguridad.conf

if [ "$(id -u)" -ne 0 ]; then echo "Ejecuta con sudo: sudo bash $0 $*"; exit 1; fi
if [ -z "$ZIP" ] || [ ! -f "$ZIP" ]; then echo "No encuentro el ZIP del sitio: '${ZIP}'"; exit 1; fi
DOMINIO=$(printf '%s' "$DOMINIO" | tr 'A-Z' 'a-z')
DOMINIO="${DOMINIO#http://}"; DOMINIO="${DOMINIO#https://}"; DOMINIO="${DOMINIO#www.}"; DOMINIO="${DOMINIO%%/*}"
if [ -n "$DOMINIO" ] && ! [[ "$DOMINIO" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; then echo "Dominio no válido: $DOMINIO"; exit 1; fi
if [ -n "$CORREO" ] && ! [[ "$CORREO" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}$ ]]; then echo "Correo no válido: $CORREO"; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt_instalar() { apt-get -o DPkg::Lock::Timeout=600 install -y -q "$@" >/dev/null; }

echo "== 1/4 Paquetes =="
if ! command -v nginx >/dev/null || ! command -v unzip >/dev/null; then
  apt-get -o DPkg::Lock::Timeout=600 update -y -q >/dev/null
  apt_instalar nginx unzip
fi
echo "Nginx $(nginx -v 2>&1 | sed 's/.*\///')"

echo "== 2/4 Copiando el sitio =="
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
unzip -q -o "$ZIP" -d "$TMP"
SRC="$TMP"   # el ZIP puede traer los archivos sueltos o dentro de una carpeta
if [ ! -f "$SRC/index.html" ]; then SRC=$(dirname "$(find "$TMP" -maxdepth 3 -name index.html | head -n1)"); fi
if [ ! -f "$SRC/index.html" ]; then echo "El ZIP no tiene index.html"; exit 1; fi
mkdir -p "$WEB"
find "$WEB" -mindepth 1 -delete
cp -r "$SRC"/. "$WEB"/
rm -f "$WEB/README.md"; rm -rf "$WEB/deploy"
chown -R www-data:www-data "$WEB"
find "$WEB" -type d -exec chmod 755 {} +
find "$WEB" -type f -exec chmod 644 {} +
echo "$(find "$WEB" -type f | wc -l) archivos en $WEB"

CERT="/etc/letsencrypt/live/$DOMINIO"
hay_cert() { [ -n "$DOMINIO" ] && [ -s "$CERT/fullchain.pem" ] && [ -s "$CERT/privkey.pem" ]; }
cubre() { openssl x509 -in "$CERT/fullchain.pem" -noout -ext subjectAltName 2>/dev/null | grep -qF "DNS:$1"; }

escribir_nginx() {
  # Cabeceras de seguridad: se incluyen a nivel de servidor y ninguna "location" usa add_header,
  # así Nginx las aplica a todas las respuestas (si una location tuviera add_header, las anularía).
  mkdir -p "$(dirname "$SEG")"
  {
    echo 'server_tokens off;'
    echo 'add_header X-Content-Type-Options "nosniff" always;'
    echo 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;'
    echo 'add_header X-Frame-Options "SAMEORIGIN" always;'
    echo 'add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;'
    if hay_cert; then echo 'add_header Strict-Transport-Security "max-age=31536000" always;'; fi
  } > "$SEG"

  local nombres="_" v6_80="" v6_443=""
  [ -n "$DOMINIO" ] && nombres="$DOMINIO www.$DOMINIO"
  if [ -s /proc/net/if_inet6 ]; then v6_80="listen [::]:80 default_server;"; v6_443="listen [::]:443 ssl http2;"; fi
  local sitio
  sitio=$(cat <<SITIO
    root $WEB;
    index index.html;
    charset utf-8;
    include $SEG;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location / { try_files \$uri \$uri/ =404; }
    # El contenido editable cambia a menudo: el navegador siempre pide la versión nueva.
    location = /index.html { expires -1; }
    location = /sitio.json { expires -1; }
    location ~* \.(png|jpe?g|webp|gif|svg|ico|mp4|webm)\$ { expires 7d; }
    location ~ /\. { deny all; }
SITIO
)
  local acme="    location ^~ /.well-known/acme-challenge/ { root $WEB; default_type text/plain; }"
  if hay_cert; then
    cat > "$CONF" <<NGINX
# Generado por instalar-lightsail.sh: no editar a mano (se reescribe en cada despliegue).
server {
    listen 80 default_server;
    $v6_80
    server_name _;
    server_tokens off;
$acme
    location / { return 301 https://$DOMINIO\$request_uri; }
}
server {
    listen 443 ssl http2;
    $v6_443
    server_name $nombres;
    ssl_certificate     $CERT/fullchain.pem;
    ssl_certificate_key $CERT/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:instituto:10m;
    ssl_session_timeout 1d;
$sitio
}
NGINX
  else
    cat > "$CONF" <<NGINX
# Generado por instalar-lightsail.sh: no editar a mano (se reescribe en cada despliegue).
server {
    listen 80 default_server;
    $v6_80
    server_name $nombres;
$acme
$sitio
}
NGINX
  fi
  ln -sf "$CONF" /etc/nginx/sites-enabled/instituto
  rm -f /etc/nginx/sites-enabled/default
  nginx -t -q
  if [ -d /run/systemd/system ]; then systemctl enable --now nginx >/dev/null 2>&1; systemctl reload nginx
  else nginx -s reload 2>/dev/null || nginx; fi
}

echo "== 3/4 Configurando Nginx =="
escribir_nginx
echo "Nginx configurado $(hay_cert && echo 'con HTTPS' || echo 'solo con HTTP')."

echo "== 4/4 HTTPS =="
IP="${IP_PUBLICA:-}"
[ -n "$IP" ] || IP=$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)
resuelve() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}' || true; }
if [ -z "$DOMINIO" ]; then
  echo "Sin dominio: el sitio queda en http://${IP:-IP-DEL-SERVIDOR}"; exit 0
fi
# Un certificado sacado antes con "certbot --nginx" se renovaría editando Nginx: se pasa al modo
# webroot (sin emitir otro). Si no se puede, queda el modo anterior, que también renueva.
pasar_a_webroot() {
  local renov="/etc/letsencrypt/renewal/$DOMINIO.conf"
  [ -f "$renov" ] && grep -qE '^authenticator *= *nginx' "$renov" || return 0
  echo "Renovación del certificado: se pasa al modo webroot (certbot ya no edita Nginx)."
  if certbot reconfigure --cert-name "$DOMINIO" --webroot -w "$WEB" --deploy-hook "systemctl reload nginx" -n; then
    echo "Renovación configurada en modo webroot."
  else
    echo "Aviso: no se pudo cambiar el modo de renovación; se mantiene el anterior, que también renueva."
  fi
}
D1=$(resuelve "$DOMINIO"); D2=$(resuelve "www.$DOMINIO")
if hay_cert && cubre "$DOMINIO" && { cubre "www.$DOMINIO" || [ "$D2" != "$IP" ]; }; then
  pasar_a_webroot
  echo "Certificado vigente para $DOMINIO (se renueva solo): https://$DOMINIO"; exit 0
fi
if [ -z "$CORREO" ]; then
  echo "Sitio en http://$DOMINIO. Para HTTPS hace falta un correo para Let's Encrypt."; exit 0
fi
if [ -z "$IP" ] || [ "$D1" != "$IP" ]; then
  echo "Todavía no hay HTTPS: $DOMINIO apunta a '${D1:-nada}' y este servidor es '${IP:-?}'."
  echo "Cuando el DNS apunte aquí, vuelve a pegar el código de despliegue."; exit 0
fi
command -v certbot >/dev/null || apt_instalar certbot
DOMS=(-d "$DOMINIO")
if [ "$D2" = "$IP" ]; then DOMS+=(-d "www.$DOMINIO"); else echo "Aviso: www.$DOMINIO aún no apunta aquí; el certificado será solo para $DOMINIO."; fi
if certbot certonly --webroot -w "$WEB" "${DOMS[@]}" --non-interactive --agree-tos --no-eff-email -m "$CORREO" \
     --keep-until-expiring --expand --deploy-hook "systemctl reload nginx"; then
  escribir_nginx
  echo "Listo: https://$DOMINIO (el certificado se renueva solo)."
else
  echo "No se pudo obtener el certificado; el sitio sigue por http. Revisa el mensaje de certbot de arriba."
  exit 2
fi
