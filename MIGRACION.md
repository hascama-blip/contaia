# Migración a Amazon Lightsail (web nueva) y rescate de datos de la web vieja

Tres fases, en este orden: **1) respaldo de la web vieja → 2) publicar la web
nueva en Lightsail → 3) migrar los datos**. Nada de la web vieja se apaga hasta
el final.

Costo objetivo: Lightsail 8 GB en São Paulo (US$ 44/mes + IGV). Con 4 GB
(US$ 24) también corre, bajando `MAX_NAVEGADORES=2`.

---

## Fase 1 · Respaldo de la web vieja (AWS: EC2 + RDS)

La versión anterior guarda los datos en **Postgres (RDS)** y los PDF en el disco
del servidor **EC2**. Se necesitan ambos.

1. **Paga lo vencido** en AWS (Facturación → Pagos). Con deuda, AWS puede
   suspender la cuenta y borrar recursos.
2. **Instantánea de RDS** (seguro): RDS → Bases de datos → selecciona la
   instancia → Acciones → *Tomar instantánea*. Guárdala hasta terminar.
3. **Instantánea del disco de EC2**: EC2 → Volúmenes → el volumen de la
   instancia → Acciones → *Crear instantánea*.
4. **Entra al servidor**: EC2 → Instancias → *Conectar* → pestaña *EC2 Instance
   Connect* (terminal en el navegador, sin llave).
5. **Datos de conexión a la base**: dentro del servidor, busca el `.env` de la app:
   ```bash
   sudo find / -name ".env" -path "*radar*" -o -name ".env" -path "*contaia*" 2>/dev/null
   cat <ruta>/.env | grep -i -E "DATABASE|PG|POSTGRES"
   ```
   Apunta `DATABASE_URL` (o host, usuario, clave y nombre de la base).
6. **Permitir la conexión desde la web nueva** (para importar directo): RDS →
   la instancia → *Modificar* → **Acceso público: Sí**, y en su *grupo de
   seguridad* agrega una regla de entrada TCP 5432 desde la IP del Lightsail
   nuevo (la obtienes en la Fase 2). Al terminar la migración, vuelve a dejar
   *Acceso público: No* o apaga RDS.
   > Alternativa si no quieres abrir RDS: desde el EC2 haz
   > `pg_dump "$DATABASE_URL" -Fc -f /tmp/radar.dump`, súbelo a S3 y pásamelo:
   > lo convierto a `store.json`.
7. **Archivos (PDF del buzón y subidos)**: en el EC2
   ```bash
   sudo find / -type d -name uploads -not -path "*/node_modules/*" 2>/dev/null
   sudo tar czf /tmp/uploads.tar.gz -C <carpeta-que-contiene-uploads> uploads
   aws s3 cp /tmp/uploads.tar.gz s3://TU-BUCKET/   # o scp a tu PC
   ```
   Descárgalo a tu PC y conviértelo a **ZIP** manteniendo la carpeta `uploads/`
   en la raíz (en Windows: descomprime el .tar.gz y comprime la carpeta
   `uploads` como ZIP).

---

## Fase 2 · Publicar la web nueva en Lightsail

1. **Crear la instancia**: Lightsail → *Crear instancia* → Región **São Paulo
   (sa-east-1)** → Linux → **Ubuntu 24.04** → plan **8 GB** (US$ 44) → nombre
   `radar-web` → Crear.
2. **IP fija**: Redes → *Crear IP estática* → adjúntala a `radar-web`.
3. **Puertos**: en la instancia → Redes → Reglas de firewall IPv4: deja **SSH 22**,
   **HTTP 80** y agrega **HTTPS 443**.
4. **Instalar**: botón *Conectar mediante SSH* (terminal en el navegador) y pega:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/hascama-blip/contaia/main/deploy/instalar-lightsail.sh | sudo bash
   ```
   Instala Docker, clona el repo en `/opt/radar`, crea `/var/data`, el swap y
   el respaldo diario.
5. **Variables**: `sudo nano /opt/radar/.env` → copia los valores que tienes en
   Railway (Variables). Guarda con Ctrl+O, Enter, Ctrl+X. Luego:
   ```bash
   sudo /opt/radar/deploy/actualizar.sh
   ```
   Tarda 3 a 5 minutos la primera vez (compila la app).
6. **Probar sin tocar el DNS**: abre `http://IP-ESTATICA` → debe cargar el login
   (sin candado todavía). Entra con el supremo.
7. **DNS** (Namecheap → Advanced DNS):
   - `A`  `www` → IP estática de Lightsail
   - `A`  `@`   → IP estática de Lightsail (Caddy redirige el apex al www)
   - Deja `MX r` (RTT) y lo demás como está.
   En 5 a 30 minutos `https://www.radartributaria.com` sale con candado
   (Caddy pide el certificado solo).
8. **Actualizaciones automáticas**: en GitHub → repo → Settings → Secrets →
   Actions crea `LIGHTSAIL_HOST` (la IP), `LIGHTSAIL_USER` (`ubuntu`) y
   `LIGHTSAIL_KEY` (contenido de la llave privada: Lightsail → Cuenta → Claves
   SSH → descargar). Desde entonces cada push a `main` despliega solo.
9. **Respaldo a S3 (recomendado)**: crea un bucket privado en S3, pon
   `S3_BUCKET=nombre` en `/opt/radar/.env` y dale permiso a la instancia
   (Lightsail no usa roles IAM: usa `aws configure` con una clave IAM que solo
   pueda escribir en ese bucket). El cron sube el `.tar.gz` cada madrugada.

---

## Fase 3 · Migrar los datos

1. Entra a la web nueva como **Supremo** → sección **🚚 Migrar datos desde la
   web vieja (Postgres)**.
2. Pega la URL `postgresql://usuario:clave@host-rds...:5432/base` y pulsa
   **Probar**: debe listar las tablas (`usuarios`, `clientes`, `buzon_mensajes`…).
   Si las tablas tienen otros nombres, copia esa salida y pásamela para ajustar
   el importador.
3. **Vista previa**: cuenta usuarios, empresas, mensajes, etc. sin escribir nada.
4. **Importar** con modo **Fusionar** (agrega lo que no exista por correo/RUC y
   conserva lo que ya está) o **Reemplazar** (la base vieja pasa a ser la
   actual). Siempre se guarda copia previa en `backups/`.
5. **PDF y archivos**: en **💾 Copia de seguridad → Restaurar desde archivo**
   sube el ZIP con la carpeta `uploads/` (Fase 1, paso 7). Solo restaura
   archivos, no toca la base.
6. **Verifica**: entra con una cuenta real (o pide a un usuario que pruebe), abre
   una empresa, el buzón y un PDF guardado. Las contraseñas se conservan (viajan
   como hash).

---

## Fase 4 · Apagar lo viejo (una semana después)

1. EC2 → Instancias → *Detener* (no terminar) la instancia vieja. Si en 7 días
   nadie extraña nada: *Terminar*.
2. RDS → *Eliminar* la instancia conservando una instantánea final.
3. EC2 → *Direcciones IP elásticas*: libera las que queden sueltas.
4. Railway: cuando el DNS ya apunte a Lightsail, puedes pausar el servicio o
   dejarlo como respaldo frío.

Resultado: una sola factura (Lightsail), web más cerca de Perú, respaldos
diarios locales y en S3, y despliegues automáticos desde GitHub.
