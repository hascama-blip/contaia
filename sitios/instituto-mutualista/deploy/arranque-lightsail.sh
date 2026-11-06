#!/bin/bash
# Script de arranque (user data) de la instancia AWS Lightsail del sitio del Instituto
# Mutualista. Se pasa al crear la instancia (publicar-lightsail.sh instancia) y Ubuntu lo
# ejecuta como root en el primer arranque. No hace falta entrar por SSH.
#
# Descarga del bucket público el actualizador (actualizar-sitio.sh), lo ejecuta una vez
# (instala Nginx y el sitio) y deja un cron que lo repite cada 5 minutos: así el servidor
# se actualiza solo cuando cambia el ZIP del sitio en el bucket, y saca el certificado
# HTTPS cuando el dominio ya apunta a él.
BUCKET_URL="${BUCKET_URL:-https://instituto-web-lfmn74.s3.us-east-2.amazonaws.com}"
export BUCKET_URL
exec >>/var/log/instituto-web-arranque.log 2>&1
echo "$(date '+%F %T') arranque: descargando el actualizador de $BUCKET_URL"
for intento in $(seq 1 60); do
  if curl -fsS --max-time 30 -o /usr/local/sbin/actualizar-sitio.sh.tmp "$BUCKET_URL/actualizar-sitio.sh" \
     && bash -n /usr/local/sbin/actualizar-sitio.sh.tmp; then
    mv -f /usr/local/sbin/actualizar-sitio.sh.tmp /usr/local/sbin/actualizar-sitio.sh
    chmod 755 /usr/local/sbin/actualizar-sitio.sh
    break
  fi
  echo "$(date '+%F %T') arranque: intento $intento sin éxito; se reintenta en 10 s"
  sleep 10
done
cat > /etc/cron.d/instituto-web <<'CRON'
# Sitio del Instituto Mutualista: sincroniza con el bucket de Lightsail cada 5 minutos.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root /usr/local/sbin/actualizar-sitio.sh
CRON
chmod 644 /etc/cron.d/instituto-web
if [ -x /usr/local/sbin/actualizar-sitio.sh ]; then
  echo "$(date '+%F %T') arranque: primera ejecución del actualizador (registro en /var/log/instituto-web.log)"
  /usr/local/sbin/actualizar-sitio.sh
  echo "$(date '+%F %T') arranque: listo"
else
  echo "$(date '+%F %T') arranque: no se pudo descargar el actualizador; el cron seguirá intentando"
fi
