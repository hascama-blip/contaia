# Instituto Mutualista — prototipo de sitio web

Sitio estático de una sola página (HTML + CSS + JS, sin dependencias) para un instituto
mutualista que ofrece cursos de salud preventivos y de especialización a sus asociados.
**No forma parte de la app ASENCOIA**: no se compila ni se despliega con Next.js.

## Páginas
- **Inicio**: portada en carrusel, accesos rápidos, próximos inicios, beneficios,
  pasos de inscripción.
- **Nosotros**: quiénes somos, modelo (gratuito / tarifa asociado / certificación), misión,
  visión, valores y equipo.
- **Cursos** (con submenú *Gratuitos* / *De pago*): filtros por tipo, área, modalidad y
  búsqueda; ficha de cada curso con temario, horario, docente y precios.
- **Contáctanos**: datos de contacto, formulario con validación (DNI, celular, Ley 29733),
  redes sociales, mapa y preguntas frecuentes.

## Administrador oculto
No hay ningún botón visible. Se abre de tres formas:
- agregando `#admin` al final del enlace;
- con `Alt` + `Shift` + `A` en computadora;
- con 5 clics seguidos en el símbolo `©` del pie de página.

Pide un **PIN** (por defecto `2026`; se cambia en la pestaña *Seguridad*). Pestañas:

| Pestaña | Qué se edita |
| --- | --- |
| Portada | Fotos del carrusel (subir, cambiar, quitar, encuadre, orden), antetítulo, título, texto y botón de cada diapositiva |
| Contacto | Nombre, lema, logo, WhatsApp, mensaje inicial de WhatsApp, teléfono, correo, horario, dirección, enlace de Google Maps |
| Redes sociales | Facebook, Instagram, TikTok, YouTube, LinkedIn, Messenger (vacío = no se muestra) |
| Botones | Texto y destino de cada botón de contacto (página, WhatsApp, llamada, correo, red social u otro enlace) y burbujas flotantes de WhatsApp / Messenger |
| Textos | Textos principales de cada página (vacío = se oculta el bloque) |
| Conectores | A dónde llega el formulario: WhatsApp, correo, servicio externo (Formspree, Google Apps Script, Make, Zapier) o solo demostración |
| Seguridad | Cambiar PIN y ver cómo entrar al panel |

El PIN solo evita que un visitante entre por accidente (el código es público). En un sitio en
producción el panel debe ir detrás de un inicio de sesión en servidor.

## Dónde se guardan los cambios
Todo el contenido editable vive en `sitio.json` (+ imágenes en `imagenes/`).
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
- `COURSES` (en el `<script>`): lista de cursos (tipo `gratis` / `pago`, precios
  asociado/público, fechas, temario).
- Colores: variables CSS en `:root` (tema claro) y en los bloques de tema oscuro.
