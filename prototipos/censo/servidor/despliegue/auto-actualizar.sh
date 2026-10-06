#!/usr/bin/env bash
# Actualización automática: si la rama en GitHub tiene una versión nueva, la trae y reinicia el portal.
# La ejecuta systemd cada 10 minutos (censo-actualizar.timer). Registro: journalctl -u censo-actualizar
set -euo pipefail
cd /opt/censo
git config --global --add safe.directory /opt/censo >/dev/null 2>&1 || true
ANTES=$(git rev-parse HEAD)
git fetch -q origin
RAMA=$(git rev-parse --abbrev-ref HEAD)
DESPUES=$(git rev-parse "origin/$RAMA")
[[ "$ANTES" == "$DESPUES" ]] && exit 0
git merge -q --ff-only "origin/$RAMA"
echo "Actualizado $ANTES → $DESPUES"
# Unidades de systemd nuevas o cambiadas
for u in censo.service censo-dominio.path censo-dominio.service censo-actualizar.service censo-actualizar.timer; do
  [[ -f "prototipos/censo/servidor/despliegue/$u" ]] && install -m 644 "prototipos/censo/servidor/despliegue/$u" /etc/systemd/system/$u
done
systemctl daemon-reload
systemctl restart censo
# Si cambió la plantilla de Caddy, reaplicar la configuración actual
if git diff --name-only "$ANTES" "$DESPUES" | grep -q "despliegue/Caddyfile"; then prototipos/censo/servidor/despliegue/configurar-dominio.sh || true; fi
sleep 2; systemctl is-active censo >/dev/null && echo "Portal activo." || { echo "ERROR: el portal no arrancó; volviendo a la versión anterior"; git reset -q --hard "$ANTES"; systemctl restart censo; }
