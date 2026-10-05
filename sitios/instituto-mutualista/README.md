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
  redes sociales, mapa y enlace a las preguntas frecuentes.

## Administrador oculto
No hay ningún botón visible ni dirección propia. Se abre de dos formas:
- con `Alt` + `Shift` + `A` en computadora;
- con 5 clics seguidos en el símbolo `©` del pie de página.

Pide un **PIN** (por defecto `2026`; se cambia en la pestaña *Seguridad*). Pestañas:

| Pestaña | Qué se edita |
| --- | --- |
| Portada | Fotos del carrusel (subir, cambiar, quitar, encuadre, orden), antetítulo, título, texto y botón de cada diapositiva |
| Preguntas frecuentes | Agregar, editar, ordenar y quitar preguntas; respuesta y botón opcional debajo de cada una |
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
- **Producción**: hace falta un backend o gestor de contenidos que reciba `sitio.json` y las fotos.

## Cómo verlo
```bash
python3 -m http.server -d sitios/instituto-mutualista   # luego abrir http://localhost:8000
```

## Qué más personalizar en el código
- `COURSES` (en el `<script>`): lista de cursos (área, fechas, horario, modalidad, docente,
  temario, constancia o certificado).
- Colores: variables CSS en `:root` (tema claro) y en los bloques de tema oscuro.
