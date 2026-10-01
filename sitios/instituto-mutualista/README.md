# Instituto Mutualista — prototipo de sitio web

Sitio estático de una sola página (HTML + CSS + JS, sin dependencias) para un instituto
mutualista que ofrece cursos de salud preventivos y de especialización a sus asociados.
**No forma parte de la app ASENCOIA**: no se compila ni se despliega con Next.js.

## Páginas
- **Inicio**: portada en carrusel (editable), accesos rápidos, próximos inicios, beneficios,
  pasos de inscripción.
- **Nosotros**: quiénes somos, modelo (gratuito / tarifa asociado / certificación), misión,
  visión, valores y equipo.
- **Cursos** (con submenú *Gratuitos* / *De pago*): filtros por tipo, área, modalidad y
  búsqueda; ficha de cada curso con temario, horario, docente y precios.
- **Contáctanos**: datos de contacto, formulario con validación (DNI, celular, Ley 29733),
  enlace a WhatsApp y preguntas frecuentes.

## Cómo verlo
Abrir `index.html` en el navegador. Para que cargue `portada.json`, servir la carpeta:

```bash
npx serve sitios/instituto-mutualista   # o: python3 -m http.server -d sitios/instituto-mutualista
```

## Qué personalizar
- `CONFIG` (al inicio del `<script>`): nombre, lema, teléfono, WhatsApp, correo, dirección,
  horario y enlace de mapa. Los valores actuales son de ejemplo.
- `COURSES`: lista de cursos (tipo `gratis` / `pago`, precios asociado/público, fechas, temario).
- Colores: variables CSS en `:root` (tema claro) y en los bloques de tema oscuro.

## Portada editable
El botón **Editar portada** permite subir fotos (se optimizan a 1920 px JPG), escribir
título/texto, elegir a dónde lleva el botón, el encuadre y el orden (máx. 8 diapositivas).
- Abierto como archivo o servidor simple: se guarda en el navegador (`localStorage`).
- Publicado como Artifact de Claude: se guarda como archivos de la página
  (`portada.json` + `portada/*.jpg`) y lo ven todos los visitantes.
- En producción hace falta un backend o gestor de contenidos para guardar las fotos, y
  conectar el formulario de contacto a un correo o sistema de admisión.
