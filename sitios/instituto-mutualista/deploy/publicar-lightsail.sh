#!/usr/bin/env bash
# Publica el sitio del Instituto Mutualista en AWS Lightsail solo por API (sin SSH).
#
#   bash publicar-lightsail.sh todo [DOMINIO] [CORREO]   # todos los pasos, en orden
#   bash publicar-lightsail.sh bucket                    # 1. bucket + llave de acceso para subir
#   bash publicar-lightsail.sh subir [DOMINIO] [CORREO]  # 2. ZIP del sitio + scripts + config.env
#   bash publicar-lightsail.sh instancia                 # 3. Ubuntu 24.04 con el script de arranque
#   bash publicar-lightsail.sh ip                        # 4. IP estática + puertos 80 y 443
#   bash publicar-lightsail.sh dns DOMINIO               # 5. zona DNS: A @ y www → IP estática
#   bash publicar-lightsail.sh estado                    # resumen de todo
#
# Cada paso revisa lo que ya existe y solo crea o cambia lo que falta: se puede repetir.
# Para actualizar el sitio después basta "subir": el servidor revisa el bucket cada 5 minutos
# (arranque-lightsail.sh → actualizar-sitio.sh) y se reinstala solo; con dominio y correo en
# config.env saca el certificado HTTPS en cuanto el dominio apunta a la IP estática.
#
# Credenciales: las de un usuario IAM con permiso lightsail:*. Si existen LS_AWS_ACCESS_KEY_ID
# y LS_AWS_SECRET_ACCESS_KEY se usan esas; si no, las AWS_* o el perfil de aws configurado.
# Para subir al bucket se crea una llave del bucket que se guarda (solo en esta máquina) en
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
ZIP_NOMBRE=instituto-mutualista-web.zip
BUCKET_URL="https://$BUCKET.s3.$REGION.amazonaws.com"
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

paso() { printf '\n== %s ==\n' "$*"; }
# ls_api ARGS... → lightsail con un mensaje claro si lo bloquea la política de la organización.
ls_api() {
  local err="$TMP/err" out
  if out=$(aws lightsail --region "${LS_REGION:-$REGION}" --output text "$@" 2>"$err"); then printf '%s' "$out"; return 0; fi
  if grep -q "service control policy" "$err"; then
    echo "BLOQUEADO: la política de la organización de AWS (SCP) no permite 'lightsail $1'." >&2
    grep -oE 'arn:aws:organizations::[^ ]+' "$err" | head -n1 | sed 's/^/  Política: /' >&2
    echo "  Debe liberarla quien administra la organización de AWS (cuenta de administración)." >&2
    exit 3
  fi
  cat "$err" >&2; return 1
}
existe() { ls_api "$@" >/dev/null 2>&1; }   # para get-* que dan NotFound si no existe
dns_api() { LS_REGION="$DNS_REGION" ls_api "$@"; }   # el DNS de Lightsail vive en us-east-1

# ---------- 1. Bucket ----------
cmd_bucket() {
  paso "1. Bucket $BUCKET"
  if existe get-buckets --bucket-name "$BUCKET"; then echo "Ya existe."
  else
    ls_api create-bucket --bucket-name "$BUCKET" --bundle-id "$BUCKET_PLAN" --no-enable-object-versioning --tags "$ETIQUETA" >/dev/null
    echo "Creado (plan $BUCKET_PLAN)."
  fi
  for _ in $(seq 1 60); do
    [ "$(ls_api get-buckets --bucket-name "$BUCKET" --query 'buckets[0].state.code')" = "OK" ] && break; sleep 5
  done
  # Privado por defecto, pero cada objeto que subimos se marca público (el sitio es público).
  # Recién creado, el bucket puede tener todavía una operación en curso: se reintenta.
  local intento
  for intento in $(seq 1 30); do
    ls_api update-bucket --bucket-name "$BUCKET" --access-rules getObject=private,allowPublicOverrides=true >/dev/null 2>"$TMP/err.upd" && break
    grep -q "conflicting conditional operation" "$TMP/err.upd" || { cat "$TMP/err.upd" >&2; exit 1; }
    sleep 10
  done
  echo "Acceso: privado, con objetos públicos permitidos uno por uno."
  if [ -s "$LLAVE_BUCKET" ]; then echo "Llave para subir: $LLAVE_BUCKET"; return; fi
  local llaves; llaves=$(ls_api get-bucket-access-keys --bucket-name "$BUCKET" --query 'sort_by(accessKeys,&createdAt)[].accessKeyId')
  if [ "$(wc -w <<<"$llaves")" -ge 2 ]; then
    echo "El bucket ya tiene 2 llaves (el máximo) y esta máquina no guarda ninguna: se borra la más antigua."
    ls_api delete-bucket-access-key --bucket-name "$BUCKET" --access-key-id "$(awk '{print $1}' <<<"$llaves")" >/dev/null
  fi
  local nueva; nueva=$(ls_api create-bucket-access-key --bucket-name "$BUCKET" --query 'accessKey.[accessKeyId,secretAccessKey]')
  mkdir -p "$(dirname "$LLAVE_BUCKET")"; ( umask 077; printf 'BUCKET_KEY_ID=%s\nBUCKET_KEY_SECRET=%s\n' $nueva > "$LLAVE_BUCKET" )
  echo "Llave nueva del bucket guardada en $LLAVE_BUCKET (no se sube a ningún lado)."
}

# ---------- 2. Subir ----------
s3() {   # s3api con la llave del bucket, por la dirección https://BUCKET.s3.REGION.amazonaws.com
  [ -s "$LLAVE_BUCKET" ] || { echo "Falta la llave del bucket: ejecuta primero 'bucket'."; exit 1; }
  local id secreto
  id=$(sed -n 's/^BUCKET_KEY_ID=//p' "$LLAVE_BUCKET"); secreto=$(sed -n 's/^BUCKET_KEY_SECRET=//p' "$LLAVE_BUCKET")
  printf '[default]\nregion = %s\ns3 =\n    addressing_style = virtual\n    us_east_1_regional_endpoint = regional\n' "$REGION" > "$TMP/s3config"
  env -u AWS_PROFILE -u AWS_DEFAULT_PROFILE -u AWS_SESSION_TOKEN AWS_CONFIG_FILE="$TMP/s3config" \
    AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_ACCESS_KEY_ID="$id" AWS_SECRET_ACCESS_KEY="$secreto" \
    aws s3api --region "$REGION" --output text "$@"
}
armar_zip() {   # ZIP reproducible: mismas fechas y orden → mismo ETag si el sitio no cambió
  local dir="$TMP/web"; mkdir -p "$dir"
  cp "$SITIO/index.html" "$SITIO/sitio.json" "$dir/"
  for d in imagenes videos; do [ -d "$SITIO/$d" ] && cp -r "$SITIO/$d" "$dir/"; done
  find "$dir" -exec env TZ=UTC touch -h -d '2001-01-01 00:00:00' {} +
  ( cd "$dir" && find . -type f | LC_ALL=C sort | TZ=UTC zip -X -q "$TMP/$ZIP_NOMBRE" -@ )
  echo "$TMP/$ZIP_NOMBRE"
}
subir_objeto() {   # subir_objeto ARCHIVO NOMBRE TIPO → solo si cambió; queda público de solo lectura
  local archivo="$1" nombre="$2" tipo="$3" md5 remoto
  md5=$(md5sum "$archivo" | awk '{print $1}')
  remoto=$(s3 head-object --bucket "$BUCKET" --key "$nombre" --query ETag 2>/dev/null | tr -d '"' || true)
  if [ "$remoto" = "$md5" ]; then echo "  $nombre: sin cambios"; return; fi
  for intento in 1 2 3 4 5 6; do   # una llave recién creada tarda unos segundos en servir
    if s3 put-object --bucket "$BUCKET" --key "$nombre" --body "$archivo" --content-type "$tipo" \
         --cache-control no-cache --acl public-read >/dev/null 2>"$TMP/err.s3"; then
      echo "  $nombre: subido ($(du -h "$archivo" | cut -f1))"; return
    fi
    sleep $((intento * 5))
  done
  cat "$TMP/err.s3" >&2; echo "No se pudo subir $nombre." >&2; exit 1
}
cmd_subir() {
  local dominio="${1:-}" correo="${2:-}"
  paso "2. Subir el sitio al bucket"
  bash -n "$AQUI/actualizar-sitio.sh"; bash -n "$AQUI/instalar-lightsail.sh"
  subir_objeto "$AQUI/actualizar-sitio.sh" actualizar-sitio.sh "text/x-shellscript; charset=utf-8"
  subir_objeto "$AQUI/instalar-lightsail.sh" instalar-lightsail.sh "text/x-shellscript; charset=utf-8"
  if [ -n "$dominio$correo" ] || ! s3 head-object --bucket "$BUCKET" --key config.env >/dev/null 2>&1; then
    printf 'DOMINIO=%s\nCORREO=%s\n' "$dominio" "$correo" > "$TMP/config.env"
    subir_objeto "$TMP/config.env" config.env "text/plain; charset=utf-8"
  else
    echo "  config.env: se conserva el del bucket (pasa DOMINIO y CORREO para cambiarlo)"
  fi
  subir_objeto "$(armar_zip)" "$ZIP_NOMBRE" application/zip
  local codigo; codigo=$(curl -s -o /dev/null -w '%{http_code}' -I "$BUCKET_URL/$ZIP_NOMBRE" || true)
  echo "Acceso público al ZIP: HTTP $codigo $([ "$codigo" = 200 ] && echo '(bien)' || echo '(¡revisar!)')"
}

# ---------- 3. Instancia ----------
cmd_instancia() {
  paso "3. Instancia $INSTANCIA ($SISTEMA, $PLAN, $ZONA)"
  if existe get-instance --instance-name "$INSTANCIA"; then echo "Ya existe."
  else
    ls_api create-instances --instance-names "$INSTANCIA" --availability-zone "$ZONA" --blueprint-id "$SISTEMA" \
      --bundle-id "$PLAN" --ip-address-type dualstack --user-data "file://$AQUI/arranque-lightsail.sh" --tags "$ETIQUETA" >/dev/null
    echo "Creada con el script de arranque (instala Nginx y el sitio desde el bucket, y deja el cron)."
  fi
  local estado=""
  for _ in $(seq 1 60); do
    estado=$(ls_api get-instance-state --instance-name "$INSTANCIA" --query 'state.name'); [ "$estado" = running ] && break; sleep 5
  done
  echo "Estado: $estado"
}

# ---------- 4. IP estática y puertos ----------
cmd_ip() {
  paso "4. IP estática $IP_NOMBRE y puertos"
  existe get-static-ip --static-ip-name "$IP_NOMBRE" || { ls_api allocate-static-ip --static-ip-name "$IP_NOMBRE" >/dev/null; echo "IP estática reservada."; }
  if [ "$(ls_api get-static-ip --static-ip-name "$IP_NOMBRE" --query 'staticIp.attachedTo')" != "$INSTANCIA" ]; then
    ls_api attach-static-ip --static-ip-name "$IP_NOMBRE" --instance-name "$INSTANCIA" >/dev/null; echo "Asignada a $INSTANCIA."
  fi
  for p in 80 443; do
    ls_api open-instance-public-ports --instance-name "$INSTANCIA" --port-info "fromPort=$p,toPort=$p,protocol=TCP" >/dev/null
  done
  echo "IP estática: $(ip_estatica)  ·  puertos abiertos: $(ls_api get-instance-port-states --instance-name "$INSTANCIA" --query 'portStates[?state==`open`].fromPort' | tr '\t' ' ')"
}
ip_estatica() { ls_api get-static-ip --static-ip-name "$IP_NOMBRE" --query 'staticIp.ipAddress'; }

# ---------- 5. DNS ----------
cmd_dns() {
  local dominio="${1:-}"
  dominio="${dominio#http://}"; dominio="${dominio#https://}"; dominio="${dominio#www.}"; dominio="${dominio%%/*}"
  [[ "$dominio" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Uso: $0 dns tudominio.pe"; exit 1; }
  paso "5. Zona DNS de $dominio"
  local ip; ip=$(ip_estatica)
  dns_api get-domain --domain-name "$dominio" >/dev/null 2>&1 || { dns_api create-domain --domain-name "$dominio" --tags "$ETIQUETA" >/dev/null; echo "Zona creada."; }
  local nombre id destino
  for nombre in "$dominio" "www.$dominio"; do
    read -r id destino < <(dns_api get-domain --domain-name "$dominio" \
      --query "domain.domainEntries[?type=='A' && name=='$nombre'] | [0].[id,target]" | sed 's/^None.*$//') || true
    if [ -z "${id:-}" ]; then
      dns_api create-domain-entry --domain-name "$dominio" --domain-entry "name=$nombre,type=A,target=$ip" >/dev/null; echo "  A $nombre → $ip (creado)"
    elif [ "$destino" != "$ip" ]; then
      dns_api update-domain-entry --domain-name "$dominio" --domain-entry "id=$id,name=$nombre,type=A,target=$ip" >/dev/null; echo "  A $nombre → $ip (antes $destino)"
    else echo "  A $nombre → $ip (ya estaba)"; fi
  done
  echo; echo "Servidores de nombres para poner en GoDaddy (Dominio → DNS → Servidores de nombres → Cambiar → 'Usaré mis propios servidores'):"
  dns_api get-domain --domain-name "$dominio" --query "domain.domainEntries[?type=='NS'].target" | tr '\t' '\n' | sed 's/\.$//; s/^/  /'
  echo "Si el dominio tiene correo, copia antes sus registros MX/TXT/CNAME a esta zona o el correo dejará de llegar."
}

# ---------- Estado ----------
cmd_estado() {
  paso "Estado"
  echo "Bucket:    $(ls_api get-buckets --bucket-name "$BUCKET" --query 'buckets[0].state.code' 2>/dev/null || echo 'no existe')"
  for o in actualizar-sitio.sh instalar-lightsail.sh config.env "$ZIP_NOMBRE"; do
    printf '  %-30s HTTP %s\n' "$o" "$(curl -s -o /dev/null -w '%{http_code}' -I "$BUCKET_URL/$o" || echo '?')"
  done
  echo "Instancia: $(ls_api get-instance-state --instance-name "$INSTANCIA" --query 'state.name' 2>/dev/null || echo 'no existe')"
  echo "IP fija:   $(ip_estatica 2>/dev/null || echo 'no reservada')"
  local dominios; dominios=$(dns_api get-domains --query 'domains[].name' 2>/dev/null || true)
  echo "Zonas DNS: ${dominios:-ninguna}"
}

accion="${1:-}"; shift || true
case "$accion" in
  bucket)    cmd_bucket ;;
  subir)     cmd_subir "$@" ;;
  instancia) cmd_instancia ;;
  ip)        cmd_ip ;;
  dns)       cmd_dns "$@" ;;
  estado)    cmd_estado ;;
  todo)      cmd_bucket; cmd_subir "$@"; cmd_instancia; cmd_ip; [ -n "${1:-}" ] && cmd_dns "$1"; cmd_estado
             echo; echo "El servidor tarda unos 3-5 minutos en instalar Nginx y el sitio: http://$(ip_estatica)" ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
