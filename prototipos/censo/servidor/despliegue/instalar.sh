#!/usr/bin/env bash
# Instala el portal en un servidor Ubuntu 24.04 recién creado (AWS Lightsail).
# Uso (como root o con sudo):  bash instalar.sh TU-DOMINIO.com correo@dominio.com
# Luego: sudo -u censo node /opt/censo/prototipos/censo/servidor/usuarios.js crear ...  (ver GUIA-AWS.md)
set -euo pipefail
DOMINIO="${1:-}"            # opcional: sin dominio el portal responde por IP (http); se puede poner luego desde Administración
CORREO="${2:-}"
CODIGO="${CODIGO:-$(openssl rand -hex 6 2>/dev/null || date +%s)}"   # código de instalación para crear el primer admin
REPO="${REPO:-https://github.com/hascama-blip/contaia.git}"
RAMA="${RAMA:-main}"

echo "== Paquetes base =="
apt-get update -y && apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

echo "== Node 22 =="
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== Caddy (HTTPS automático) =="
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== Usuario y carpetas =="
id -u censo >/dev/null 2>&1 || useradd --system --home /var/censo --shell /usr/sbin/nologin censo
mkdir -p /var/censo /opt/censo
chown -R censo:censo /var/censo

echo "== Código (solo la carpeta del portal) =="
if [[ ! -d /opt/censo/.git ]]; then
  git clone --depth 1 --branch "$RAMA" --filter=blob:none --sparse "$REPO" /opt/censo
  git -C /opt/censo sparse-checkout set prototipos/censo
fi
git config --global --add safe.directory /opt/censo >/dev/null 2>&1 || true
git -C /opt/censo pull --ff-only || echo "AVISO: no se pudo actualizar el código (se sigue con el que hay)."
chown -R censo:censo /opt/censo

# Paquete único de la web (esbuild). Si falla, el portal sigue funcionando con los módulos sueltos.
compilar_web() {
  local C=/opt/censo/prototipos/censo/servidor/compilar
  if command -v npm >/dev/null && [[ -f "$C/package.json" ]]; then
    (cd "$C" && npm install --no-audit --no-fund --loglevel=error --omit=dev >/dev/null 2>&1 && node construir.mjs) && chown -R censo:censo /opt/censo/prototipos/censo/dist 2>/dev/null || echo "AVISO: no se pudo compilar la web; se sirven los módulos sueltos."
  fi
}
compilar_web

echo "== Configuración =="
if [[ ! -f /etc/censo.env ]]; then
  sed "s|CAMBIAR-POR-UNA-CADENA-LARGA-AL-AZAR|$(openssl rand -hex 32)|" /opt/censo/prototipos/censo/servidor/despliegue/censo.env.ejemplo > /etc/censo.env
  echo "CENSO_CODIGO_INSTALACION=$CODIGO" >> /etc/censo.env
  chmod 600 /etc/censo.env
fi
touch /var/censo/dominio.txt && chown censo:censo /var/censo/dominio.txt
if [[ -n "$DOMINIO" ]]; then echo "$DOMINIO $CORREO" > /var/censo/dominio.txt; fi
install -m 644 /opt/censo/prototipos/censo/servidor/despliegue/censo.service /etc/systemd/system/censo.service
install -m 644 /opt/censo/prototipos/censo/servidor/despliegue/censo-dominio.path /etc/systemd/system/
install -m 644 /opt/censo/prototipos/censo/servidor/despliegue/censo-dominio.service /etc/systemd/system/
install -m 644 /opt/censo/prototipos/censo/servidor/despliegue/censo-actualizar.service /etc/systemd/system/
install -m 644 /opt/censo/prototipos/censo/servidor/despliegue/censo-actualizar.timer /etc/systemd/system/

echo "== Servicios =="
systemctl daemon-reload
systemctl enable --now censo censo-dominio.path censo-actualizar.timer
/opt/censo/prototipos/censo/servidor/despliegue/configurar-dominio.sh || { echo "AVISO: Caddy no tomó la configuración; revisa: journalctl -u caddy -n 30"; }
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

echo
echo "Listo. Comprueba: systemctl status censo caddy"
CODIGO_REAL="$(grep -oP '^CENSO_CODIGO_INSTALACION=\K.*' /etc/censo.env 2>/dev/null || echo "$CODIGO")"
echo "Código de instalación (para crear la cuenta administradora desde la pantalla de entrada): $CODIGO_REAL"
echo "Lo encuentras también en /etc/censo.env (CENSO_CODIGO_INSTALACION)."
echo "Carga el padrón (semilla.json generado con herramientas/importar_padron.py):"
echo "  sudo -u censo DATOS=/var/censo node /opt/censo/prototipos/censo/servidor/importar.js /ruta/semilla.json"
echo "Para el token de apidni: edita /etc/censo.env y luego  systemctl restart censo"
