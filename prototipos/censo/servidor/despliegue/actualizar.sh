#!/usr/bin/env bash
# Trae la última versión del código y reinicia el portal (los datos no se tocan).
set -euo pipefail
git config --global --add safe.directory /opt/censo >/dev/null 2>&1 || true
git -C /opt/censo pull --ff-only
for u in censo-actualizar.service censo-actualizar.timer; do install -m 644 /opt/censo/prototipos/censo/servidor/despliegue/$u /etc/systemd/system/$u; done
systemctl daemon-reload
systemctl enable --now censo-actualizar.timer
# Paquete único de la web (esbuild). Si falla, el portal sigue funcionando con los módulos sueltos.
compilar_web() {
  local C=/opt/censo/prototipos/censo/servidor/compilar
  if command -v npm >/dev/null && [[ -f "$C/package.json" ]]; then
    (cd "$C" && npm install --no-audit --no-fund --loglevel=error --omit=dev >/dev/null 2>&1 && node construir.mjs) && chown -R censo:censo /opt/censo/prototipos/censo/dist 2>/dev/null || echo "AVISO: no se pudo compilar la web; se sirven los módulos sueltos."
  fi
}
compilar_web
systemctl restart censo
systemctl status censo --no-pager | head -5
