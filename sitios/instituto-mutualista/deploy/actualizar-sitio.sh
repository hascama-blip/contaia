#!/usr/bin/env bash
# Actualizador del sitio del Instituto Mutualista en el servidor AWS Lightsail.
#
# Lo deja instalado arranque-lightsail.sh (script de arranque de la instancia) y lo ejecuta
# cron cada 5 minutos. No necesita SSH: todo lo que el servidor necesita vive en el bucket
# de Lightsail (objetos públicos de solo lectura, BUCKET_URL):
#   actualizar-sitio.sh           este script (se renueva solo)
#   instalar-lightsail.sh         el instalador (Nginx + sitio + certificado HTTPS)
#   config.env                    DOMINIO=... y CORREO=... (vacíos = solo por IP)
#   instituto-mutualista-web.zip  el sitio (index.html, sitio.json, imagenes/, videos/)
#
# Cada ejecución compara el ETag de cada objeto y descarga solo lo que cambió. Si algo
# cambió —o falta el certificado HTTPS y el dominio ya apunta a este servidor— vuelve a
# ejecutar el instalador. Registro: /var/log/instituto-web.log
set -uo pipefail

BUCKET_URL="${BUCKET_URL:-https://instituto-web-lfmn74.s3.us-east-2.amazonaws.com}"
ESTADO=/var/lib/instituto-web          # copias descargadas, etags y marcas
SBIN=/usr/local/sbin
ZIP="$ESTADO/instituto-mutualista-web.zip"
LOG=/var/log/instituto-web.log
WEB=/var/www/instituto
ESPERA_TRAS_FALLO=3600                 # 1 h entre intentos fallidos de certificado (límites de Let's Encrypt)

mkdir -p "$ESTADO"
# Un solo actualizador a la vez.
exec 9>/run/lock/instituto-web.lock
flock -n 9 || exit 0
# El registro se recorta si pasa de 1 MB.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 1048576 ]; then tail -n 500 "$LOG" > "$LOG.tmp" && mv -f "$LOG.tmp" "$LOG"; fi
exec >>"$LOG" 2>&1
log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

# descargar NOMBRE DESTINO → 0 si bajó una versión nueva, 1 si no cambió, 2 si no se pudo.
descargar() {
  local nombre="$1" destino="$2" url="$BUCKET_URL/$1" marca="$ESTADO/$1.etag" etag
  etag=$(curl -fsSI --max-time 20 "$url" 2>/dev/null | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')
  [ -n "$etag" ] || return 2
  if [ -f "$destino" ] && [ -f "$marca" ] && [ "$(cat "$marca")" = "$etag" ]; then return 1; fi
  if ! curl -fsS --max-time 600 -o "$destino.tmp" "$url"; then rm -f "$destino.tmp"; return 2; fi
  mv -f "$destino.tmp" "$destino"
  printf '%s' "$etag" > "$marca"
  return 0
}
resolver() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}'; }
ip_publica() {
  if [ -n "${IP_PUBLICA:-}" ]; then echo "$IP_PUBLICA"; return; fi
  curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true
}

# 1. Este mismo script: si hay versión nueva en el bucket, se instala y se vuelve a ejecutar.
if [ -z "${ACTUALIZADOR_RENOVADO:-}" ] && descargar actualizar-sitio.sh "$ESTADO/actualizar-sitio.sh"; then
  if bash -n "$ESTADO/actualizar-sitio.sh"; then
    if ! cmp -s "$ESTADO/actualizar-sitio.sh" "$SBIN/actualizar-sitio.sh"; then
      install -m 755 "$ESTADO/actualizar-sitio.sh" "$SBIN/actualizar-sitio.sh"
      log "Actualizador renovado desde el bucket; se vuelve a ejecutar."
      export ACTUALIZADOR_RENOVADO=1
      exec "$SBIN/actualizar-sitio.sh"
    fi
  else
    log "El actualizador del bucket tiene errores de sintaxis; se conserva el actual."
  fi
fi

# 2. Lo que haya cambiado en el bucket.
cambio=0
if descargar instalar-lightsail.sh "$SBIN/instalar-lightsail.sh"; then chmod 755 "$SBIN/instalar-lightsail.sh"; cambio=1; log "Instalador nuevo."; fi
if [ ! -f "$SBIN/instalar-lightsail.sh" ]; then log "Aún no hay instalar-lightsail.sh en el bucket."; exit 0; fi
if descargar config.env "$ESTADO/config.env"; then cambio=1; log "Configuración nueva: $(tr '\n' ' ' < "$ESTADO/config.env")"; fi
if descargar instituto-mutualista-web.zip "$ZIP"; then cambio=1; log "ZIP nuevo del sitio."; fi
if [ ! -f "$ZIP" ]; then log "Aún no hay instituto-mutualista-web.zip en el bucket."; exit 0; fi
[ "$cambio" = 1 ] && touch "$ESTADO/pendiente"

# 3. Dominio y correo (de config.env), saneados: nada que no parezca dominio/correo se usa.
DOMINIO=""; CORREO=""
if [ -f "$ESTADO/config.env" ]; then
  DOMINIO=$(sed -n 's/^DOMINIO=//p' "$ESTADO/config.env" | head -n1 | tr -d '[:space:]"'"'" | tr 'A-Z' 'a-z')
  CORREO=$(sed -n 's/^CORREO=//p' "$ESTADO/config.env" | head -n1 | tr -d '[:space:]"'"'")
fi
DOMINIO="${DOMINIO#http://}"; DOMINIO="${DOMINIO#https://}"; DOMINIO="${DOMINIO#www.}"; DOMINIO="${DOMINIO%%/*}"
[[ "$DOMINIO" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || DOMINIO=""
[[ "$CORREO" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}$ ]] || CORREO=""

# 4. ¿Toca intentar el certificado HTTPS? Solo con dominio y correo, si falta el certificado
#    (o no cubre www y www ya apunta aquí), si el dominio resuelve a esta IP y si el último
#    intento fallido no fue hace menos de una hora.
IP=""; intentar_cert=0
falta_certificado() {
  local cert="/etc/letsencrypt/live/$DOMINIO/fullchain.pem"
  [ -s "$cert" ] || return 0
  if ! openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null | grep -qF "DNS:www.$DOMINIO"; then
    [ "$(resolver "www.$DOMINIO")" = "$IP" ] && return 0
  fi
  return 1
}
if [ -n "$DOMINIO" ] && [ -n "$CORREO" ]; then
  IP=$(ip_publica)
  if [ -n "$IP" ] && falta_certificado; then
    if [ -f "$ESTADO/certificado.fallo" ] && [ $(( $(date +%s) - $(cat "$ESTADO/certificado.fallo") )) -lt "$ESPERA_TRAS_FALLO" ]; then
      [ -f "$ESTADO/pendiente" ] && log "Certificado: el último intento falló hace menos de 1 h; se espera."
    elif [ "$(resolver "$DOMINIO")" = "$IP" ]; then
      intentar_cert=1
    elif [ -f "$ESTADO/pendiente" ]; then
      log "Certificado: $DOMINIO apunta a '$(resolver "$DOMINIO")' y este servidor es $IP; se espera al DNS."
    fi
  fi
fi

# 5. Ejecutar el instalador si hay algo pendiente, si aún no está el sitio o si toca el certificado.
motivo=""
if [ -f "$ESTADO/pendiente" ] || [ ! -f "$WEB/index.html" ]; then motivo="cambios en el bucket"
elif [ "$intentar_cert" = 1 ]; then motivo="certificado HTTPS"
fi
[ -n "$motivo" ] || exit 0
CORREO_HOY=""; [ "$intentar_cert" = 1 ] && CORREO_HOY="$CORREO"
log "== Instalador: $motivo (dominio='${DOMINIO:-sin dominio}' certificado=$intentar_cert) =="
# 9>&-: el candado no pasa al instalador; si no, Nginx (o certbot al reiniciarlo) lo heredaría
# y lo mantendría tomado para siempre, y las siguientes ejecuciones no harían nada.
IP_PUBLICA="$IP" bash "$SBIN/instalar-lightsail.sh" "$ZIP" "$DOMINIO" "$CORREO_HOY" 9>&-
codigo=$?
if [ "$codigo" = 0 ]; then
  rm -f "$ESTADO/pendiente"
  log "== Instalador terminado bien =="
else
  log "== El instalador falló (código $codigo); se reintenta en la próxima ejecución =="
fi
if [ "$intentar_cert" = 1 ]; then
  if falta_certificado; then
    date +%s > "$ESTADO/certificado.fallo"
    log "Certificado HTTPS aún no emitido para $DOMINIO; nuevo intento en 1 h."
  else
    rm -f "$ESTADO/certificado.fallo"
    log "Certificado HTTPS en orden para $DOMINIO."
  fi
fi
