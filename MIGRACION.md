# Migración a Amazon Lightsail (web nueva) y rescate de datos de la web vieja

Tres fases, en este orden: **1) respaldo de la web vieja → 2) publicar la web
nueva en Lightsail → 3) migrar los datos**. Nada de la web vieja se apaga hasta
el final.

Costo objetivo: Lightsail 8 GB en São Paulo (US$ 44/mes + IGV). Con 4 GB
(US$ 24) también corre, bajando `MAX_NAVEGADORES=2`.

---

## Fase 1 · Respaldo de la web vieja (`app.radartributaria.com`, AWS: EC2 + RDS)

La versión anterior la hizo y la despliega el programador; **no se necesita su
código ni sus claves**: con la cuenta de AWS (dueña de los recursos) basta.
Los datos están en **Postgres (RDS)** y los PDF en el disco del **EC2**.

1. **Paga lo vencido** en AWS (Facturación → Pagos). Con deuda, AWS puede
   suspender la cuenta y borrar recursos.
2. **Instantáneas (tu seguro)**: RDS → Bases de datos → la instancia → Acciones →
   *Tomar instantánea*. EC2 → Volúmenes → el volumen → Acciones → *Crear
   instantánea*. Guárdalas hasta terminar.

### 1A · Base de datos, sin pedirle nada al programador

La clave de la base la tiene el programador. En vez de cambiarla en la base
viva (dejaría caída la web vieja), se trabaja sobre una **copia**:

3. RDS → *Instantáneas* → la que tomaste → Acciones → **Restaurar instantánea**.
   Nombre `radar-copia`, la clase más pequeña (db.t4g.micro), **Acceso
   público: Sí**. Tarda 5 a 10 minutos. Cuesta centavos por las horas que viva.
4. En `radar-copia` → *Modificar* → **Nueva contraseña maestra** (pon una tuya)
   → Aplicar inmediatamente. El usuario maestro aparece en la pestaña
   *Configuración* (suele ser `postgres`); el nombre de la base también.
5. En el *grupo de seguridad* de `radar-copia` → Reglas de entrada → agrega
   **PostgreSQL (5432)** desde la IP del Lightsail nuevo (Fase 2) o, mientras
   pruebas, desde *Mi IP*.
6. Arma la URL: `postgresql://postgres:TU-CLAVE@ENDPOINT-DE-radar-copia:5432/NOMBRE_BD`
   (el *Endpoint* está en *Conectividad y seguridad*). Esa URL es la que pegas en
   la web nueva (Fase 3). **No toca la base real.**
7. Al terminar la migración, **elimina `radar-copia`** para no pagarla.

### 1B · Archivos (PDF del buzón y subidos), que viven en el disco del EC2

8. EC2 → Instancias → la instancia → **Conectar** → pestaña *EC2 Instance
   Connect* (terminal en el navegador, sin llave; usuario `ubuntu` o
   `ec2-user`). Si no deja entrar, usa la pestaña *Session Manager*.
   ```bash
   sudo find / -type d -name uploads -not -path "*/node_modules/*" 2>/dev/null
   sudo tar czf /tmp/uploads.tar.gz -C <carpeta-que-contiene-uploads> uploads
   ```
   Para bajarlo: `aws s3 cp /tmp/uploads.tar.gz s3://TU-BUCKET/` (si `aws` no
   existe: `sudo apt install -y awscli` y `aws configure` con una clave IAM
   tuya), y descárgalo desde la consola de S3.
9. **Si ninguna pestaña de "Conectar" funciona** (el programador no habilitó el
   acceso): EC2 → Instantáneas → la del disco → Acciones → *Crear volumen* en la
   misma zona → adjúntalo a una instancia nueva tuya (o al Lightsail no se
   puede; usa un EC2 t3.micro temporal) → `sudo mount /dev/xvdf1 /mnt` → copia
   la carpeta `uploads` desde `/mnt`. Luego apaga y elimina esa instancia.
10. En tu PC convierte el `.tar.gz` a **ZIP** manteniendo la carpeta `uploads/`
    en la raíz (descomprime y vuelve a comprimir la carpeta `uploads`).

> Atajo si la relación lo permite: pídele al programador un `pg_dump` de la
> base y el `tar` de `uploads`. Con eso te saltas 1A y 1B. El `pg_dump` me lo
> pasas y lo convierto, o lo restauras tú en `radar-copia`.

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
   - **`app` NO se toca todavía**: sigue apuntando a AWS (web vieja) hasta
     terminar la Fase 3. Después, `A app` → IP de Lightsail y en el servidor
     `echo "DOMINIO_VIEJO=app.radartributaria.com" | sudo tee -a /opt/radar/.env`
     seguido de `sudo /opt/radar/deploy/actualizar.sh`: Caddy redirige
     `app.radartributaria.com` a `www`, así los usuarios con el enlace viejo
     caen en la web nueva.
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
