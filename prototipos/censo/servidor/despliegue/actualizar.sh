#!/usr/bin/env bash
# Trae la última versión del código y reinicia el portal (los datos no se tocan).
set -euo pipefail
git config --global --add safe.directory /opt/censo >/dev/null 2>&1 || true
git -C /opt/censo pull --ff-only
for u in censo-actualizar.service censo-actualizar.timer; do install -m 644 /opt/censo/prototipos/censo/servidor/despliegue/$u /etc/systemd/system/$u; done
systemctl daemon-reload
systemctl enable --now censo-actualizar.timer
systemctl restart censo
systemctl status censo --no-pager | head -5
