#!/usr/bin/env bash
# Instala el portal en un servidor Ubuntu 24.04 recién creado (AWS Lightsail).
# Uso (como root o con sudo):  bash instalar.sh TU-DOMINIO.com correo@dominio.com
# Luego: sudo -u censo node /opt/censo/prototipos/censo/servidor/usuarios.js crear ...  (ver GUIA-AWS.md)
set -euo pipefail
DOMINIO="${1:?Falta el dominio, ej. inmaculadaconcepcion.pe}"
CORREO="${2:?Falta el correo para los certificados}"
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
git -C /opt/censo pull --ff-only || true
chown -R censo:censo /opt/censo

echo "== Configuración =="
if [[ ! -f /etc/censo.env ]]; then
  sed "s|CAMBIAR-POR-UNA-CADENA-LARGA-AL-AZAR|$(openssl rand -hex 32)|" /opt/censo/prototipos/censo/servidor/despliegue/censo.env.ejemplo > /etc/censo.env
  chmod 600 /etc/censo.env
fi
sed -e "s|TU-DOMINIO.com|$DOMINIO|g" -e "s|directiva@$DOMINIO|$CORREO|" /opt/censo/prototipos/censo/servidor/despliegue/Caddyfile > /etc/caddy/Caddyfile
install -m 644 /opt/censo/prototipos/censo/servidor/despliegue/censo.service /etc/systemd/system/censo.service

echo "== Servicios =="
systemctl daemon-reload
systemctl enable --now censo
systemctl restart caddy
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

echo
echo "Listo. Comprueba: systemctl status censo caddy"
echo "Crea el primer usuario (administrador):"
echo "  sudo -u censo DATOS=/var/censo node /opt/censo/prototipos/censo/servidor/usuarios.js crear admin \"Nombre Apellido\" 'UnaClaveLarga' admin"
echo "Carga el padrón (semilla.json generado con herramientas/importar_padron.py):"
echo "  sudo -u censo DATOS=/var/censo node /opt/censo/prototipos/censo/servidor/importar.js /ruta/semilla.json"
echo "Para el token de apidni: edita /etc/censo.env y luego  systemctl restart censo"
