#!/usr/bin/env bash
# Trae la última versión del código y reinicia el portal (los datos no se tocan).
set -euo pipefail
git -C /opt/censo pull --ff-only
systemctl restart censo
systemctl status censo --no-pager | head -5
