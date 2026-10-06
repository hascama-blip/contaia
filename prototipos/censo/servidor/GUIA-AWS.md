# Poner el portal en AWS con el dominio de GoDaddy

Guía paso a paso para la directiva. El portal corre en un servidor pequeño de
**AWS Lightsail** (precio fijo mensual), con **usuario y clave** para la directiva,
datos, documentos y fotos guardados en ese servidor, y HTTPS automático.

Qué se necesita: cuenta de AWS, el dominio comprado en GoDaddy y unos 30 minutos.

## 1. Cuenta de AWS y usuario de trabajo
1. Crear la cuenta en https://aws.amazon.com (tarjeta y teléfono). Activar la
   verificación en dos pasos (MFA) para la cuenta raíz.
2. **No usar la cuenta raíz para trabajar.** En *IAM → Users → Create user*:
   nombre `censo-admin`, marcar *Provide user access to the AWS Management Console*.
   Permisos: *Attach policies directly* → `AmazonLightsailFullAccess`.
3. (Solo si quieren que Claude monte el servidor por ellos) en ese mismo usuario:
   *Security credentials → Create access key → Command Line Interface*. Guardar
   el **Access key ID** y la **Secret access key**. Esas claves se pegan en la
   configuración del entorno de Claude Code (variables `AWS_ACCESS_KEY_ID` y
   `AWS_SECRET_ACCESS_KEY`), **nunca en el chat**. Se pueden borrar al terminar.

> **Nota (oct. 2026):** en esta cuenta la organización de AWS **bloquea Lightsail** (crear
> instancias, IPs y buckets). El servidor se crea entonces en **EC2** con
> `despliegue/crear-ec2.sh` (instancia `t4g.micro` Ubuntu 24.04, IP elástica, disco de 20 GB,
> ≈ US$ 11/mes con la IP pública). El resto de la guía aplica igual; donde dice Lightsail,
> léase EC2. El usuario IAM necesita la política `AmazonEC2FullAccess`.

## 2. Servidor en Lightsail
1. https://lightsail.aws.amazon.com → *Create instance*.
2. Región: **US East (N. Virginia, us-east-1)**. La organización de AWS de la cuenta solo
   permite Virginia y Ohio (São Paulo está bloqueado por política); desde Lima va bien.
3. Plataforma *Linux/Unix* → *OS Only* → **Ubuntu 24.04 LTS**.
4. Plan: **$7/mes (1 GB RAM, 40 GB SSD)** es suficiente (el padrón, fotos y
   documentos ocupan poco). Nombre: `portal-inmaculada`.
5. Al crearse: pestaña *Networking* → **Create static IP** y adjuntarla a la
   instancia. Anotar esa IP (ej. `18.230.45.10`).
6. En *Networking → IPv4 Firewall* dejar **SSH (22), HTTP (80) y HTTPS (443)**.
7. Pestaña *Snapshots* → activar **Automatic snapshots** (copia diaria del disco).

## 3. Dominio en GoDaddy → servidor
En GoDaddy: *Mis productos → Dominio → DNS → Administrar*. Crear o editar:

| Tipo | Nombre | Valor                 | TTL      |
|------|--------|-----------------------|----------|
| A    | `@`    | la IP estática        | 600 seg  |
| A    | `www`  | la IP estática        | 600 seg  |

Borrar cualquier otro registro `A` o `CNAME` de `@` y `www` (el "Parked" de GoDaddy).
Tarda entre 10 minutos y 1 hora en propagarse. Comprobar: `nslookup TU-DOMINIO.com`.

## 4. Instalar el portal (automático al crear la instancia)
Si la instancia se creó con el script de arranque `despliegue/arranque.sh` (lo hace Claude con
`aws lightsail create-instances --user-data`), **no hay que entrar por SSH**: a los 3‑5 minutos
el portal responde en `http://IP-ESTATICA/` y muestra la pantalla de **primera configuración**.
1. Abrir `http://IP-ESTATICA/`, escribir el **código de instalación** (te lo entrega quien creó
   la instancia; también está en `/etc/censo.env`), tu nombre, un usuario y una clave → se crea
   la cuenta administradora y entras.
2. Arriba a la derecha → **Administración**: crear los usuarios de la directiva, **importar** el
   `semilla.json` del padrón (o un respaldo) y, cuando los registros A de GoDaddy ya apunten a la
   IP, escribir el **dominio** y guardar: el servidor pide el certificado HTTPS solo.
3. El token de apidni sí requiere SSH una vez: `sudo nano /etc/censo.env` → `APIDNI_TOKEN=...`
   → `sudo systemctl restart censo`.

## 4b. Instalar a mano (si no se usó el script de arranque)
1. En Lightsail, botón **Connect using SSH** (terminal en el navegador).
2. Pegar, cambiando dominio y correo:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/hascama-blip/contaia/main/prototipos/censo/servidor/despliegue/instalar.sh -o instalar.sh
   sudo bash instalar.sh TU-DOMINIO.com correo@TU-DOMINIO.com
   ```
   Instala Node 22, Caddy (certificado HTTPS automático), el portal como servicio
   que arranca solo y el cortafuegos. Al terminar imprime los comandos siguientes.
3. Crear la primera persona administradora:
   ```bash
   sudo -u censo DATOS=/var/censo node /opt/censo/prototipos/censo/servidor/usuarios.js crear admin "Nombre Apellido" 'UnaClaveLarga' admin
   ```
4. Cargar el padrón real. En la computadora, generar la semilla con
   `herramientas/importar_padron.py` (ver LEEME) y subirla al servidor
   (botón de subir archivo en el SSH del navegador, o `scp`), luego:
   ```bash
   sudo -u censo DATOS=/var/censo node /opt/censo/prototipos/censo/servidor/importar.js /home/ubuntu/semilla.json
   ```
5. Token de la consulta de DNI (apidni.com): `sudo nano /etc/censo.env`, poner
   `APIDNI_TOKEN=...`, guardar y `sudo systemctl restart censo`.
6. Abrir `https://TU-DOMINIO.com` → pantalla de entrada → listo.

## 5. Usuarios de la directiva
Roles: **admin** (todo y manejar usuarios), **edicion** (registrar y modificar),
**lectura** (solo consultar). Lo normal es manejarlos desde **Administración** en el portal
(`/admin.html`, solo admin). También desde el SSH:
```bash
cd /opt/censo/prototipos/censo/servidor
sudo -u censo DATOS=/var/censo node usuarios.js crear tesorera "Nombre Apellido" 'Clave' edicion
sudo -u censo DATOS=/var/censo node usuarios.js listar
sudo -u censo DATOS=/var/censo node usuarios.js clave tesorera 'ClaveNueva'
sudo -u censo DATOS=/var/censo node usuarios.js borrar tesorera
```
Las sesiones duran 12 horas; tras 10 claves equivocadas una IP espera 15 minutos.

## 6. Mantenimiento
- **Actualizar el portal**: es automático. Cada 10 minutos el servidor revisa GitHub
  (`censo-actualizar.timer`) y, si hay versión nueva, la instala y reinicia el portal; si el
  portal no arranca, vuelve a la versión anterior. A mano: `sudo bash /opt/censo/prototipos/censo/servidor/despliegue/actualizar.sh`.
- **Respaldo**: `sudo /opt/censo/prototipos/censo/servidor/despliegue/respaldo.sh`
  deja un `.tgz` en `/var/censo-respaldos` (y las snapshots de Lightsail copian el disco entero).
  Descargar una copia al mes fuera del servidor.
- **Ver que todo corre**: `systemctl status censo caddy` · registro: `journalctl -u censo -n 50`.
- Los datos viven en `/var/censo` (`asociados.json`, `stands.json`, `pagos.json`,
  `incidencias.json`, `usuarios.json`, carpeta `archivos/`). Nunca están en el repositorio.

## Costos aproximados
Lightsail $7/mes + snapshots ~$2/mes + dominio (ya pagado en GoDaddy). Certificado HTTPS: gratis.
