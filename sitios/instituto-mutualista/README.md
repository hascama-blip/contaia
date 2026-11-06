# Instituto Mutualista — prototipo de sitio web

Sitio estático de una sola página (HTML + CSS + JS, sin dependencias) para un instituto
mutualista que ofrece cursos de salud preventivos y de especialización a sus asociados.
**No forma parte de la app ASENCOIA**: no se compila ni se despliega con Next.js.

## Páginas
- **Inicio**: portada en carrusel, accesos rápidos, próximos inicios, beneficios,
  pasos de inscripción.
- **Nosotros**: quiénes somos, modelo (gratuito / tarifa asociado / certificación), misión,
  visión, valores y equipo.
- **Cursos** (con submenú *Todos los cursos* / *Videos de 30 s*): todos los cursos son para
  **asociados y familiares** (no hay cursos de pago ni precios). Filtros por área, modalidad y
  búsqueda; ficha de cada curso con temario, horario, modalidad, docente y tipo de constancia o
  certificado. El sitio publica los cursos y lleva a la plataforma de cursos. El botón **"Ingresar"** de cada ficha abre esa plataforma (enlace general
  o uno por curso), donde la persona entra con su usuario y contraseña. Si aún no hay enlace,
  "Ingresar" lleva a Contáctanos con el mensaje "Quiero recibir mi usuario…".
- **Videos de vista previa (30 s)**: clips cortos que muestran de qué trata cada curso. Se ven en
  Inicio ("Conoce nuestros cursos en 30 segundos", los 3 primeros), en Cursos → Videos
  (`#cursos-videos`), como botón "Vista previa" en la tarjeta del curso y dentro de su ficha.
  En computadora se reproducen en silencio al pasar el mouse. Se suben como archivo MP4 (H.264)
  o WebM de hasta 30 s y 15 MB; el panel rechaza los más largos y saca la portada del video.
  Alternativa: enlace de YouTube, del que solo se muestran los primeros 30 s.
- **Preguntas frecuentes** (pestaña propia, `#preguntas`): pensada para personas mayores, con
  letra grande y botón de tamaño de letra (A / A+ / A++), buscador ("Escribe tu duda"), preguntas
  que se abren con un toque, un botón opcional debajo de cada respuesta (Ingresar, Ver los cursos,
  Ver los videos, WhatsApp o Contáctanos) y un recuadro de ayuda con WhatsApp y teléfono.
  Las preguntas se agregan, editan, ordenan y quitan en el panel.
- **Contáctanos**: datos de contacto, formulario con validación (DNI, celular, Ley 29733),
  redes sociales, mapa y enlace a las preguntas frecuentes. La casilla obligatoria dice "Acepto
  los términos y condiciones y autorizo el tratamiento de mis datos…", con enlace a esa página.
- **Términos y condiciones** (`#terminos`, en el menú como "Términos", en el menú del celular y en
  el pie de página): fecha de última actualización, introducción y secciones numeradas con índice
  (fijo al costado en computadora, plegable en celular), con el mismo control de tamaño de letra
  que las preguntas frecuentes. Trae un **texto modelo** de 15 secciones (participantes, cursos
  sin costo, usuario y contraseña, certificados, contenido de salud solo educativo, datos
  personales según la Ley 29733, etc.). Debe revisarlo el área legal de la mutual antes de publicar.

## Administrador oculto
No hay ningún botón visible ni dirección propia. Se abre de dos formas:
- con `Alt` + `Shift` + `A` en computadora;
- con 5 clics seguidos en el símbolo `©` del pie de página.

Pide un **PIN** (por defecto `2026`; se cambia en la pestaña *Seguridad*). Pestañas:

| Pestaña | Qué se edita |
| --- | --- |
| Portada | Fotos del carrusel (subir, cambiar, quitar, encuadre, orden), antetítulo, título, texto y botón de cada diapositiva |
| Preguntas frecuentes | Agregar, editar, ordenar y quitar preguntas; respuesta y botón opcional debajo de cada una |
| Términos | Fecha de actualización, introducción y secciones (agregar, editar, ordenar, quitar). Los marcadores `{nombre}`, `{correo}`, `{telefono}`, `{whatsapp}` y `{direccion}` se reemplazan por los datos de Contacto |
| Videos (30 s) | Subir clips de vista previa (máx. 30 s), elegir de qué curso son, título, descripción, expositor, portada, enlace al curso completo y orden |
| Contacto | Nombre, lema, logo, WhatsApp, mensaje inicial de WhatsApp, teléfono, correo, horario, dirección, enlace de Google Maps |
| Redes sociales | Facebook, Instagram, TikTok, YouTube, LinkedIn, Messenger (vacío = no se muestra) |
| Botones | Texto y destino de cada botón de contacto (página, WhatsApp, llamada, correo, red social u otro enlace) y burbujas flotantes de WhatsApp / Messenger |
| Textos | Textos principales de cada página (vacío = se oculta el bloque) |
| Conectores | **Plataforma de cursos** (enlace general, texto del botón "Ingresar" y enlace por curso) y a dónde llega el formulario: WhatsApp, correo, servicio externo (Formspree, Google Apps Script, Make, Zapier) o solo demostración |
| Seguridad | Cambiar PIN y ver cómo entrar al panel |

El PIN solo evita que un visitante entre por accidente (el código es público). En un sitio en
producción el panel debe ir detrás de un inicio de sesión en servidor.

## Colores
La paleta sale del logo de la AMSP: azul `#0B6296` (principal), azul medio `#2C78A4` y gris
azulado claro `#E8F0F0`, sobre fondo blanco. El naranja `#FF9F1C` queda solo para los botones
principales. Los tokens están en `:root`.

## Dónde se guardan los cambios
Todo el contenido editable vive en `sitio.json` (+ imágenes en `imagenes/` y videos en `videos/`).
El logo de la Asociación Mutualista Sanitaria del Perú (AMSP) está en `imagenes/logo-amsp.png`
(recortado en círculo con fondo transparente) y `sitio.json` lo usa como logo del sitio.
- **Publicado como Artifact de Claude**: al guardar se publican `sitio.json` y las fotos como
  archivos de la página; lo ven todos los visitantes. Solo quien tiene permiso de edición
  puede guardar.
- **Abierto como archivo o servidor simple**: se guarda en el navegador (`localStorage`).
- **Producción (institutoamsp.com)**: el panel oculto guarda solo en el navegador de quien lo usa;
  los visitantes no ven esos cambios. Los cambios se hacen en los archivos y se publican con un
  código de despliegue (ver *Publicar en AWS Lightsail*).

## Cómo verlo
```bash
python3 -m http.server -d sitios/instituto-mutualista   # luego abrir http://localhost:8000
```

## Publicar en AWS Lightsail
Publicado en **https://institutoamsp.com**: servidor Lightsail `instituto-mutualista` (Ubuntu 24.04,
plan nano) en **us-east-2 (Ohio)**, IP estática `18.119.230.5`, zona DNS de Lightsail para el dominio
(registrado en GoDaddy, con los servidores de nombres de Lightsail). La región es us-east-2 porque la
política de la organización de AWS (`AdvancedModeRegionRestrictionSecurityControlPolicy`) solo deja
crear recursos ahí; en us-east-1 permite el DNS de Lightsail, que se crea en esa región.

### Actualizar el sitio: código de despliegue
Nada se publica solo. Cada cambio llega como un **código de una línea** que se pega en el servidor:

1. Se editan los archivos del sitio (`index.html`, `sitio.json`, `imagenes/`, `videos/`).
2. `bash deploy/publicar-lightsail.sh codigo` arma la versión (sitio + instalador + `aplicar.sh`), la
   sube al bucket **privado** `instituto-web-lfmn74` y muestra el código.
3. En Lightsail → instancia `instituto-mutualista` → **Conectar mediante SSH**, se pega el código y se
   pulsa Enter. Descarga la versión con un enlace firmado que **vence en 7 días**, comprueba su huella
   SHA-256 y la instala. Termina con `LISTO`.

`aplicar.sh` respalda la versión anterior (las 5 últimas, en `/var/backups/instituto`) y deja registro
en `/var/log/instituto-despliegues.log`. Si el dominio ya apunta al servidor y falta el certificado,
lo obtiene en ese momento. El dominio y el correo del certificado se guardan en `config.env` del
bucket privado; para cambiarlos: `codigo DOMINIO CORREO`.

### Seguridad del servidor
- `instalar-lightsail.sh` genera **toda** la configuración de Nginx en cada despliegue, también la de
  HTTPS. Certbot solo obtiene y renueva el certificado (modo webroot) y no edita la configuración.
- Cabeceras en todas las respuestas: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy` y, con certificado, `Strict-Transport-Security`. No se muestra la versión de
  Nginx. Solo TLS 1.2 y 1.3. Con certificado, http y la IP redirigen a `https://DOMINIO`.
- No se sirven `README.md`, `deploy/` ni archivos ocultos. Los métodos que escriben dan 405.
- El bucket es privado: nada se lee sin un enlace firmado, y solo quien tiene la llave del bucket
  (guardada fuera del repositorio) o el usuario IAM con `lightsail:*` puede subir versiones.

### Servidor desde cero
```bash
bash deploy/publicar-lightsail.sh todo tudominio.pe tu@correo
```
Crea el bucket, la instancia (su script de arranque es el código de despliegue de la versión
actual, así que se instala sola), la IP estática, los puertos 80 y 443 y la zona DNS, y muestra los
servidores de nombres para el registrador. Cada paso revisa lo que ya existe y se puede repetir.

**Dominio:** si tiene correo, hay que copiar sus registros MX, TXT y CNAME a la zona de Lightsail
**antes** de cambiar los servidores de nombres. Con institutoamsp.com solo se copió el TXT `_dmarc`
(el dominio no tiene correo).

## Qué más personalizar en el código
- `COURSES` (en el `<script>`): lista de cursos (área, fechas, horario, modalidad, docente,
  temario, constancia o certificado).
- Colores: variables CSS en `:root` (tema claro) y en los bloques de tema oscuro.
