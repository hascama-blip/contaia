#!/usr/bin/env bash
# Instalación en un servidor nuevo (Ubuntu 22.04/24.04: Lightsail, EC2 o VPS).
# Deja la web corriendo con HTTPS, datos en /var/data, respaldo diario y
# actualización con un comando. Ejecutar como root o con sudo:
#   curl -fsSL https://raw.githubusercontent.com/hascama-blip/contaia/main/deploy/instalar-lightsail.sh | sudo bash
set -euo pipefail

REPO="https://github.com/hascama-blip/contaia.git"
DIR="/opt/radar"

echo "==> Paquetes base"
apt-get update -y
apt-get install -y ca-certificates curl git unzip awscli

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Swap de 2 GB (colchón para los navegadores headless)"
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Código"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
mkdir -p /var/data/uploads /var/data/backups
chmod +x "$DIR"/deploy/*.sh

if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/deploy/.env.ejemplo" "$DIR/.env"
  echo
  echo "!! Falta completar las variables: edita $DIR/.env (nano $DIR/.env) y vuelve a correr:"
  echo "   sudo $DIR/deploy/actualizar.sh"
  echo
fi

echo "==> Respaldo diario a las 02:30 (hora del servidor) y limpieza de Docker"
cat > /etc/cron.d/radar <<EOF
30 2 * * * root $DIR/deploy/respaldo-s3.sh >> /var/log/radar-respaldo.log 2>&1
0 5 * * 0 root docker system prune -af --filter "until=168h" >/dev/null 2>&1
EOF

if grep -q "^AUTH_SECRET=cambia-esto" "$DIR/.env"; then
  echo "==> Variables aún sin completar; la web se levantará cuando ejecutes actualizar.sh"
  exit 0
fi

echo "==> Levantando la web"
"$DIR/deploy/actualizar.sh"
echo
echo "Listo. Apunta el DNS (A) de tu dominio a la IP de este servidor; Caddy emitirá el certificado solo."
