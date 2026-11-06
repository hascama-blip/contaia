#!/usr/bin/env bash
# Publica y actualiza el sitio del Instituto Mutualista en AWS Lightsail.
#
#   bash publicar-lightsail.sh codigo [DOMINIO] [CORREO]  # versión nueva → código de despliegue
#   bash publicar-lightsail.sh todo DOMINIO CORREO        # servidor desde cero (todos los pasos)
#   bash publicar-lightsail.sh bucket                     # 1. bucket privado + llave para subir
#   bash publicar-lightsail.sh instancia                  # 2. Ubuntu 24.04 que se instala sola
#   bash publicar-lightsail.sh ip                         # 3. IP estática + puertos 80 y 443
#   bash publicar-lightsail.sh dns DOMINIO                # 4. zona DNS: A @ y www → IP estática
#   bash publicar-lightsail.sh estado                     # resumen
#
# Actualizar el sitio: "codigo" arma una versión (sitio + instalador + aplicar.sh), la sube al
# bucket PRIVADO y muestra un código de una línea. Se pega en la terminal del servidor
# (Lightsail → instancia → Conectar mediante SSH): descarga la versión con un enlace firmado
# que vence en 7 días, comprueba su huella SHA-256 y la instala. Nada se publica sin ese paso.
#
# Credenciales: las de un usuario IAM con permiso lightsail:*. Si existen LS_AWS_ACCESS_KEY_ID
# y LS_AWS_SECRET_ACCESS_KEY se usan esas; si no, las AWS_* o el perfil de aws configurado.
# Para subir al bucket se crea una llave del bucket que se guarda solo en esta máquina, en
# $LLAVE_BUCKET (por defecto ~/.config/instituto-lightsail/llave-bucket.env).
set -euo pipefail

# La política de la organización (AdvancedModeRegionRestrictionSecurityControlPolicy) solo deja
# crear servidores y buckets en us-east-2; en us-east-1 permite el DNS de Lightsail, que solo
# existe ahí.
REGION=us-east-2
ZONA=us-east-2a
DNS_REGION=us-east-1
BUCKET=instituto-web-lfmn74
BUCKET_PLAN=small_1_0          # 5 GB, 25 GB de transferencia
INSTANCIA=instituto-mutualista
PLAN=nano_3_0                  # el más pequeño con IPv4 pública
SISTEMA=ubuntu_24_04
IP_NOMBRE=instituto-mutualista-ip
VIGENCIA=604800                # 7 días, el máximo de un enlace firmado
LLAVE_BUCKET="${LLAVE_BUCKET:-$HOME/.config/instituto-lightsail/llave-bucket.env}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITIO="$(dirname "$AQUI")"
ETIQUETA="key=proyecto,value=instituto-mutualista"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
export AWS_PAGER=""
if [ -n "${LS_AWS_ACCESS_KEY_ID:-}" ]; then
  export AWS_ACCESS_KEY_ID="$LS_AWS_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$LS_AWS_SECRET_ACCESS_KEY"
  unset AWS_SESSION_TOKEN AWS_PROFILE
fi
command -v aws >/dev/null || { echo "Falta la AWS CLI (pip install awscli o https://aws.amazon.com/cli/)"; exit 1; }

paso() { printf '\n== %s ==\n' "$*" >&2; }
# ls_api ARGS... → lightsail con un mensaje claro si lo bloquea la política de la organización.
ls_api() {
  local err="$TMP/err" out
  if out=$(aws lightsail --region "${LS_REGION:-$REGION}" --output text "$@" 2>"$err"); then printf '%s' "$out"; return 0; fi
  if grep -q "service control policy" "$err"; then
    echo "BLOQUEADO: la política de la organización de AWS (SCP) no permite 'lightsail $1'." >&2
    grep -oE 'arn:aws:organizations::[^ ]+' "$err" | head -n1 | sed 's/^/  Política: /' >&2
    exit 3
  fi
  cat "$err" >&2; return 1
}
existe() { ls_api "$@" >/dev/null 2>&1; }   # para get-* que dan NotFound si no existe
dns_api() { LS_REGION="$DNS_REGION" ls_api "$@"; }   # el DNS de Lightsail vive en us-east-1

# ---------- Bucket (privado) ----------
cmd_bucket() {
  paso "Bucket $BUCKET (privado)"
  if existe get-buckets --bucket-name "$BUCKET"; then echo "Ya existe." >&2
  else
    ls_api create-bucket --bucket-name "$BUCKET" --bundle-id "$BUCKET_PLAN" --no-enable-object-versioning --tags "$ETIQUETA" >/dev/null
    echo "Creado (plan $BUCKET_PLAN)." >&2
  fi
  for _ in $(seq 1 60); do
    [ "$(ls_api get-buckets --bucket-name "$BUCKET" --query 'buckets[0].state.code')" = "OK" ] && break; sleep 5
  done
  local intento   # recién creado puede tener una operación en curso: se reintenta
  for intento in $(seq 1 30); do
    ls_api update-bucket --bucket-name "$BUCKET" --access-rules getObject=private,allowPublicOverrides=false >/dev/null 2>"$TMP/err.upd" && break
    grep -q "conflicting conditional operation" "$TMP/err.upd" || { cat "$TMP/err.upd" >&2; exit 1; }
    sleep 10
  done
  echo "Acceso: privado; nada del bucket se puede leer sin un enlace firmado." >&2
  if [ -s "$LLAVE_BUCKET" ]; then echo "Llave para subir: $LLAVE_BUCKET" >&2; return; fi
  local llaves; llaves=$(ls_api get-bucket-access-keys --bucket-name "$BUCKET" --query 'sort_by(accessKeys,&createdAt)[].accessKeyId')
  if [ "$(wc -w <<<"$llaves")" -ge 2 ]; then
    echo "El bucket ya tiene 2 llaves (el máximo) y esta máquina no guarda ninguna: se borra la más antigua." >&2
    ls_api delete-bucket-access-key --bucket-name "$BUCKET" --access-key-id "$(awk '{print $1}' <<<"$llaves")" >/dev/null
  fi
  local nueva; nueva=$(ls_api create-bucket-access-key --bucket-name "$BUCKET" --query 'accessKey.[accessKeyId,secretAccessKey]')
  mkdir -p "$(dirname "$LLAVE_BUCKET")"; ( umask 077; printf 'BUCKET_KEY_ID=%s\nBUCKET_KEY_SECRET=%s\n' $nueva > "$LLAVE_BUCKET" )
  echo "Llave nueva del bucket guardada en $LLAVE_BUCKET (no se sube a ningún lado)." >&2
  sleep 10   # una llave recién creada tarda unos segundos en servir
}

# aws_bucket s3api|s3 ... → con la llave del bucket, por https://BUCKET.s3.REGION.amazonaws.com
aws_bucket() {
  [ -s "$LLAVE_BUCKET" ] || cmd_bucket
  local id secreto
  id=$(sed -n 's/^BUCKET_KEY_ID=//p' "$LLAVE_BUCKET"); secreto=$(sed -n 's/^BUCKET_KEY_SECRET=//p' "$LLAVE_BUCKET")
  printf '[default]\nregion = %s\ns3 =\n    addressing_style = virtual\n' "$REGION" > "$TMP/s3config"
  env -u AWS_PROFILE -u AWS_DEFAULT_PROFILE -u AWS_SESSION_TOKEN AWS_CONFIG_FILE="$TMP/s3config" \
    AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_ACCESS_KEY_ID="$id" AWS_SECRET_ACCESS_KEY="$secreto" \
    aws "$1" --region "$REGION" "${@:2}"
}
subir_privado() {   # subir_privado ARCHIVO CLAVE TIPO (reintenta: una llave nueva tarda en servir)
  local intento
  for intento in 1 2 3 4 5 6; do
    aws_bucket s3api put-object --bucket "$BUCKET" --key "$2" --body "$1" --content-type "$3" --output text >/dev/null 2>"$TMP/err.s3" && return 0
    sleep $((intento * 5))
  done
  cat "$TMP/err.s3" >&2; echo "No se pudo subir $2." >&2; exit 1
}
armar_zip() {   # armar_zip DESTINO → ZIP reproducible del sitio (mismas fechas y orden)
  local dir="$TMP/web"; rm -rf "$dir"; mkdir -p "$dir"
  cp "$SITIO/index.html" "$SITIO/sitio.json" "$dir/"
  for d in imagenes videos; do [ -d "$SITIO/$d" ] && cp -r "$SITIO/$d" "$dir/"; done
  find "$dir" -exec env TZ=UTC touch -h -d '2001-01-01 00:00:00' {} +
  ( cd "$dir" && find . -type f | LC_ALL=C sort | TZ=UTC zip -X -q "$1" -@ )
}

# ---------- Código de despliegue ----------
cmd_codigo() {
  local dominio="${1:-}" correo="${2:-}"
  paso "Versión nueva y código de despliegue"
  # Dominio y correo: los argumentos, o los guardados en config.env del bucket privado.
  if [ -n "$dominio" ]; then
    printf 'DOMINIO=%s\nCORREO=%s\n' "$dominio" "$correo" > "$TMP/config.env"
    subir_privado "$TMP/config.env" config.env "text/plain; charset=utf-8"
  elif aws_bucket s3api get-object --bucket "$BUCKET" --key config.env "$TMP/config.env" --output text >/dev/null 2>&1; then
    dominio=$(sed -n 's/^DOMINIO=//p' "$TMP/config.env"); correo=$(sed -n 's/^CORREO=//p' "$TMP/config.env")
  fi
  echo "Dominio: ${dominio:-ninguno} · correo del certificado: ${correo:-ninguno}" >&2
  bash -n "$AQUI/aplicar.sh"; bash -n "$AQUI/instalar-lightsail.sh"
  local rel="$TMP/release"; mkdir -p "$rel"
  armar_zip "$rel/sitio.zip"
  sed -e "s|__DOMINIO__|$dominio|" -e "s|__CORREO__|$correo|" "$AQUI/aplicar.sh" > "$rel/aplicar.sh"
  cp "$AQUI/instalar-lightsail.sh" "$rel/"
  local commit; commit=$(git -C "$SITIO" rev-parse --short HEAD 2>/dev/null || echo "sin-git")
  printf '%s · commit %s · sitio %s\n' "$(date -u '+%F %H:%M UTC')" "$commit" "$(sha256sum "$rel/sitio.zip" | cut -c1-8)" > "$rel/VERSION"
  ( cd "$rel" && zip -X -q "$TMP/version.zip" aplicar.sh instalar-lightsail.sh sitio.zip VERSION )
  local sha clave url
  sha=$(sha256sum "$TMP/version.zip" | awk '{print $1}')
  clave="versiones/$(date -u +%Y%m%d-%H%M%S)-${sha:0:8}.zip"
  subir_privado "$TMP/version.zip" "$clave" application/zip
  url=$(aws_bucket s3 presign "s3://$BUCKET/$clave" --expires-in "$VIGENCIA")
  # Comprobación: el enlace firmado descarga exactamente lo que se subió.
  curl -fsS --max-time 60 -o "$TMP/comprobar.zip" "$url" || { echo "El enlace firmado no descarga." >&2; exit 1; }
  [ "$(sha256sum "$TMP/comprobar.zip" | awk '{print $1}')" = "$sha" ] || { echo "La descarga no coincide con lo subido." >&2; exit 1; }
  echo "Versión: $(cat "$rel/VERSION") · $clave · vence $(date -u -d "+$VIGENCIA seconds" '+%F %H:%M UTC')" >&2
  # El enlace va en base64: así el código no contiene texto con forma de llave de AWS, que
  # algunas apps ocultan con puntos al mostrarlo (y entonces se copia alterado).
  local u64; u64=$(printf '%s' "$url" | base64 -w0)
  printf "U=\$(echo '%s' | base64 -d); D=\$(mktemp -d); if ! curl -fsSL -o \"\$D/v.zip\" \"\$U\"; then echo 'ERROR: no se pudo descargar la versión (código vencido o copiado incompleto). No se instaló nada.'; elif ! echo \"%s  \$D/v.zip\" | sha256sum -c --quiet -; then echo 'ERROR: la versión descargada no coincide con su huella. No se instaló nada.'; else python3 -m zipfile -e \"\$D/v.zip\" \"\$D/v\" && sudo bash \"\$D/v/aplicar.sh\"; fi\n" "$u64" "$sha"
}

# ---------- Instancia ----------
cmd_instancia() {
  paso "Instancia $INSTANCIA ($SISTEMA, $PLAN, $ZONA)"
  if existe get-instance --instance-name "$INSTANCIA"; then echo "Ya existe." >&2
  else
    # Script de arranque = el código de despliegue de la versión actual: se instala sola.
    { echo '#!/bin/bash'; echo 'exec >>/var/log/instituto-arranque.log 2>&1'; cmd_codigo "$@"; } > "$TMP/arranque.sh"
    ls_api create-instances --instance-names "$INSTANCIA" --availability-zone "$ZONA" --blueprint-id "$SISTEMA" \
      --bundle-id "$PLAN" --ip-address-type dualstack --user-data "file://$TMP/arranque.sh" --tags "$ETIQUETA" >/dev/null
    echo "Creada; al arrancar se instala sola con la versión actual." >&2
  fi
  local estado=""
  for _ in $(seq 1 60); do
    estado=$(ls_api get-instance-state --instance-name "$INSTANCIA" --query 'state.name'); [ "$estado" = running ] && break; sleep 5
  done
  echo "Estado: $estado" >&2
}

# ---------- IP estática y puertos ----------
ip_estatica() { ls_api get-static-ip --static-ip-name "$IP_NOMBRE" --query 'staticIp.ipAddress'; }
cmd_ip() {
  paso "IP estática $IP_NOMBRE y puertos"
  existe get-static-ip --static-ip-name "$IP_NOMBRE" || { ls_api allocate-static-ip --static-ip-name "$IP_NOMBRE" >/dev/null; echo "IP estática reservada." >&2; }
  if [ "$(ls_api get-static-ip --static-ip-name "$IP_NOMBRE" --query 'staticIp.attachedTo')" != "$INSTANCIA" ]; then
    ls_api attach-static-ip --static-ip-name "$IP_NOMBRE" --instance-name "$INSTANCIA" >/dev/null; echo "Asignada a $INSTANCIA." >&2
  fi
  for p in 80 443; do
    ls_api open-instance-public-ports --instance-name "$INSTANCIA" --port-info "fromPort=$p,toPort=$p,protocol=TCP" >/dev/null
  done
  echo "IP estática: $(ip_estatica) · puertos abiertos: $(ls_api get-instance-port-states --instance-name "$INSTANCIA" --query 'portStates[?state==`open`].fromPort' | tr '\t' ' ')" >&2
}

# ---------- DNS ----------
cmd_dns() {
  local dominio="${1:-}"
  dominio="${dominio#http://}"; dominio="${dominio#https://}"; dominio="${dominio#www.}"; dominio="${dominio%%/*}"
  [[ "$dominio" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Uso: $0 dns tudominio.pe" >&2; exit 1; }
  paso "Zona DNS de $dominio"
  local ip; ip=$(ip_estatica)
  dns_api get-domain --domain-name "$dominio" >/dev/null 2>&1 || { dns_api create-domain --domain-name "$dominio" --tags "$ETIQUETA" >/dev/null; echo "Zona creada." >&2; }
  local nombre id destino
  for nombre in "$dominio" "www.$dominio"; do
    read -r id destino < <(dns_api get-domain --domain-name "$dominio" \
      --query "domain.domainEntries[?type=='A' && name=='$nombre'] | [0].[id,target]" | sed 's/^None.*$//') || true
    if [ -z "${id:-}" ]; then
      dns_api create-domain-entry --domain-name "$dominio" --domain-entry "name=$nombre,type=A,target=$ip" >/dev/null; echo "  A $nombre → $ip (creado)" >&2
    elif [ "$destino" != "$ip" ]; then
      dns_api update-domain-entry --domain-name "$dominio" --domain-entry "id=$id,name=$nombre,type=A,target=$ip" >/dev/null; echo "  A $nombre → $ip (antes $destino)" >&2
    else echo "  A $nombre → $ip (ya estaba)" >&2; fi
  done
  echo "Servidores de nombres para el registrador del dominio (GoDaddy → DNS → Servidores de nombres):" >&2
  dns_api get-domain --domain-name "$dominio" --query "domain.domainEntries[?type=='NS'].target" | tr '\t' '\n' | sed 's/\.$//; s/^/  /' >&2; echo >&2
  echo "Si el dominio tiene correo, copia antes sus registros MX/TXT/CNAME a esta zona." >&2
}

# ---------- Estado ----------
cmd_estado() {
  paso "Estado"
  echo "Bucket:    $(ls_api get-buckets --bucket-name "$BUCKET" --query 'buckets[0].[state.code,accessRules.getObject]' 2>/dev/null | tr '\t' ' ' || echo 'no existe')"
  if [ -s "$LLAVE_BUCKET" ]; then
    echo "Última versión subida: $(aws_bucket s3api list-objects-v2 --bucket "$BUCKET" --prefix versiones/ --query 'sort_by(Contents,&LastModified)[-1].Key' --output text 2>/dev/null || echo '?')"
  fi
  echo "Instancia: $(ls_api get-instance-state --instance-name "$INSTANCIA" --query 'state.name' 2>/dev/null || echo 'no existe')"
  echo "IP fija:   $(ip_estatica 2>/dev/null || echo 'no reservada')"
  echo "Puertos:   $(ls_api get-instance-port-states --instance-name "$INSTANCIA" --query 'portStates[].[fromPort,join(`,`,cidrListAliases)]' 2>/dev/null | tr '\t\n' ': ' || true)"
  echo "Zonas DNS: $(dns_api get-domains --query 'domains[].name' 2>/dev/null || echo ninguna)"
}

accion="${1:-}"; shift || true
case "$accion" in
  codigo)    cmd_codigo "$@" ;;
  bucket)    cmd_bucket ;;
  instancia) cmd_instancia "$@" ;;
  ip)        cmd_ip ;;
  dns)       cmd_dns "$@" ;;
  estado)    cmd_estado ;;
  todo)      [ -n "${1:-}" ] || { echo "Uso: $0 todo DOMINIO CORREO" >&2; exit 1; }
             cmd_bucket; cmd_instancia "$@"; cmd_ip; cmd_dns "$1"; cmd_estado
             echo; echo "El servidor tarda unos 3-5 minutos en instalarse: http://$(ip_estatica)" ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
