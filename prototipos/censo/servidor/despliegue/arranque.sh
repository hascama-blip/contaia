#!/bin/bash
# Script de arranque (user-data) para una instancia nueva de Lightsail Ubuntu 24.04.
# Lo pasa `aws lightsail create-instances --user-data`. Variables rellenadas al crear:
#   RAMA (rama de git), CODIGO (código de instalación), DOMINIO/CORREO (opcionales).
exec > /var/log/censo-arranque.log 2>&1
set -x
export DEBIAN_FRONTEND=noninteractive
export RAMA="__RAMA__" CODIGO="__CODIGO__"
cd /root
for i in 1 2 3 4 5; do curl -fsSL "https://raw.githubusercontent.com/hascama-blip/contaia/$RAMA/prototipos/censo/servidor/despliegue/instalar.sh" -o instalar.sh && break; sleep 10; done
bash instalar.sh "__DOMINIO__" "__CORREO__"
echo "ARRANQUE-TERMINADO"
