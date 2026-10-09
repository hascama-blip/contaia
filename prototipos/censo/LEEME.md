# Censo C.C. "Inmaculada Concepción" — prototipo

Prototipo publicado como página privada en Claude (no está en Render).
Estilo y organización por capas copiados de Radar Tributar·IA.

## Capas (igual que Radar)

| Carpeta | Papel | Equivalente en Radar |
|---|---|---|
| `src/config.js` | Galerías, cuotas, listas y regla de 3 incidencias | mapas ajustables (`REGLAS_CUENTA`, `MAPA_CASILLAS`) |
| `src/plano.js` | **Plano real** (generado desde el PDF con `herramientas/calcar_plano.py`) | — |
| `src/lib/types.js` | Forma de cada documento y etiquetas de estados | `src/lib/types.ts` |
| `src/lib/db.js` | **Única puerta a la base.** Nadie más la toca | `src/lib/db.ts` |
| `src/lib/*.js` | Reglas puras: padrón, pagos, incidencias, validación, exportar | `src/lib/*.ts` |
| `src/api/*.js` | Servicios: validan y escriben con `db.js` | `src/app/api/**/route.ts` |
| `src/components/*.js` | Piezas de interfaz (badges, tablas, formularios, paneles) | `src/components/*.tsx` |
| `src/pages/*.js` | Una pantalla por sección | `src/app/**/page.tsx` |
| `src/main.js` | Arranque, rutas (`#padron`, `#ficha-…`) y derivados | `src/app/layout.tsx` |
| `estilos/tokens.css` | Paleta verde (#0B8A30 · #33BE5B · #62DCB9 · #FFE3B3); cajas en verde profundo | `tailwind.config.ts` |
| `estilos/app.css` | `.card .btn .input .badge`… | `globals.css` |

Regla: una pantalla lee datos del contexto y, para escribir, llama a `api/`.
`api/` valida y llama a `lib/db.js`. Para pasar a Radar o a Postgres solo se
reescribe `lib/db.js` (y `lib/archivos.js` para las fotos).

## Plano (real)

`src/plano.js` es el **plano real** del C.C., calcado del *Mapa de riesgo MR-01*
(agosto 2025) con `herramientas/calcar_plano.py`. Trae 396 stands numerados
1001–1405, cada uno con su galería (A–M; M, K y L son las del perímetro) y su
polígono, más el fondo (muros, SS.HH., escaleras), pasajes y calles.
No se edita a mano: si el plano cambia, se vuelve a correr

    pip install pymupdf shapely
    python3 herramientas/calcar_plano.py MAPA_DE_RIESGO.pdf

El código de un stand es su número del plano (`"1091"`); la galería sale del
plano (`galeriaDeCodigo`). `lib/plano.js` da los stands y el color por estado;
`components/Plano.js` dibuja el SVG, la burbuja con "Ver detalle" y el zoom.

## Documentos

Cada asociado guarda `documentos: [{id, nombre, archivo, tipo, tamano, subidoAt}]`.
El nombre visible sale del archivo (`Contrato_compraventa_1091.pdf` →
"Contrato compraventa 1091") y se puede renombrar. Acepta PDF, fotos y texto;
Word/Excel no (se pide guardarlos como PDF).

## Propietarios (ventas y traspasos)

Un propietario anterior **nunca se borra**. "Registrar venta o traspaso" (en
Stands o en la ficha) llama a `api/stands.js → transferirStand`: el dueño que
sale pasa a `stand.historial` (`{asociadoId, nombre, dni, desde, hasta, motivo,
documento, observacion, por, registradoAt}`, con nombre y DNI copiados) y el
nuevo queda en `propietarioId` desde `propietarioDesde`. Si el anterior se
queda sin stands, su ficha pasa a "Transferido" (sigue en el padrón, fuera del
avance). La línea 1.º → 2.º → actual sale de `lib/propietarios.js`. Quitar un
stand desde la ficha también deja el tramo en el historial.

## Venta de un stand y N° de padrón (regla del libro)
Al registrar una venta (**Registrar venta** en la ficha o en Stands) **no se crea un N° nuevo**:
- Si quien vende se queda **sin stands** (sale del padrón) y quien compra **no tiene N° propio**
  (es nuevo o figura "S/N"), el comprador **hereda el N°** del vendedor (`numero`, `numeroDesde`,
  `numeroHeredadoDe`). El vendedor queda con estado **Transferido**, `numero` vacío y el registro en
  `numeroHistorial` (N°, fecha, a quién lo cedió, stand). Se muestra como **"ex N° 226"** en el padrón,
  la ficha y el buscador, y sigue en el historial del stand.
- Si el comprador ya tiene N° propio, lo conserva; el vendedor queda Transferido con su N° en el historial.
- Si el vendedor **conserva otros stands**, no hay N° que heredar: un comprador nuevo recibe el
  siguiente libre (es el único caso en que aparece un N° nuevo).
Lógica en `src/lib/propietarios.js` (`numeroAHeredar`) y `src/api/stands.js` (`transferirStand`);
etiquetas en `src/lib/padron.js` (`tieneNumero`, `etiquetaNumero`, `numeroCedido`).

## Traspasos anotados en el libro (automático)
Al arrancar, el servidor aplica las ventas que el libro de padrón dejó anotadas (`traspasosAnotadosEnElLibro`
en `servidor/lib/migraciones.js`): si una ficha sin N° trae la nota del importador "Figura en la ficha del
stand XXXX, que hoy está a nombre de N° YYY: verificar traspaso" y la ficha del dueño actual tiene la nota
adhesiva "VENDIÓ…", el stand pasa al comprador, el vendedor queda Transferido en el historial del stand y el
comprador hereda el N° (misma regla que "Registrar venta"). La nota se reemplaza por el registro del traspaso
(fecha de asiento; la fecha real de la venta no está en el libro). Idempotente. Casos del padrón 2026:
stand 1077 (Rojas Guardia → Gutiérrez Oscco, N° 226) y stand 1181 (Huillcas Villa → Pablo Ramos, N° 123).

## Padrón real (importación)

El padrón se cargó desde el Excel transcrito del Libro de Padrón con
`herramientas/importar_padron.py` (252 asociados, 331 stands). El script genera
los documentos en una carpeta fuera del repo (los datos personales no se versionan):

    python3 herramientas/importar_padron.py Padron_Asociados.xlsx /ruta/salida

- N° de asociado "S/N" → `S/N-1`, `S/N-2`… (ids `asn1`…).
- Fichas con observaciones de la transcripción → `revisar: true` (aviso en la
  ficha y filtro "Por revisar" en el Padrón; se quita con "Ya la revisé").
- Un stand en dos fichas (posible traspaso) queda a nombre de la ficha con N°.
- `stand.cuenta` = N° de cuenta de ese stand (columna "N° Cuenta Bco.").
- Pagos: `COBRANZA_DESDE` (config.js) marca desde qué mes se registran; lo
  anterior no cuenta como deuda.

## Consulta de DNI (RENIEC)

Botón «Buscar en RENIEC» junto al DNI (Nueva ficha y Registrar venta → persona
nueva): llena nombres, apellidos, fecha de nacimiento, dirección y distrito, y
si el plan trae la foto del DNI (base64) la sube como "Fotografía tipo carné"
(`fotoComoArchivo`; en la venta se sube apenas se crea la ficha del comprador).
La consulta la hace Radar (`/api/reniec/{dni}`, token de apidni.com en Render);
aquí solo va `CONSULTA_DNI = { url, clave }` en `src/config.js` (`clave` =
`RENIEC_API_KEY` de Radar; solo sirve para consultar DNI). Con `clave: ""` el
botón no aparece. `lib/reniec.js` hace la llamada; `components/BotonReniec.js`
es el botón.

## Datos

Colecciones: `asociados`, `stands` (id = número del plano, p. ej. `1091`; el dueño está en
`propietarioId`, los anteriores en `historial`), `pagos` (id = `1091_2026`, `registros["mantenimiento-09"]`),
`incidencias`. Los registros con `ejemplo: true` se vacían desde **Reportes**.

## Tecnología

React 18 + htm (plantillas `html\`…\`` sin compilación), cargados desde CDN.
PDF de la ficha con jsPDF (se carga al pedir el PDF).

## Servidor propio en AWS (dominio de GoDaddy)
Carpeta `servidor/`: servidor Node 22 **sin dependencias** que reemplaza lo que da
claude.ai (base de datos, archivos, usuario, avisos en vivo) para correr el portal en
**AWS Lightsail** con **usuario y clave** para la directiva. Pasos completos en
`servidor/GUIA-AWS.md`.
- `servidor.js` — rutas `/api/db/:col`, `/api/archivos` + `/_blob/:id`, `/api/sesion`,
  `/api/usuarios`, `/api/eventos` (SSE) y `/api/reniec/:dni` (token en el servidor).
  Sirve `index.html` inyectando `publico/adaptador.js` (mismo `window.claude`).
- `lib/almacen.js` (JSON por colección, escritura atómica), `lib/sesiones.js` (scrypt +
  cookie firmada, roles admin/edicion/lectura/seguridad; `seguridad` solo escribe en
  `incidencias` y nunca borra), `lib/reniec.js` (apidni con caché).
- `usuarios.js` (crear/listar/clave/rol/borrar) · `importar.js` (carga `semilla.json`).
- Primera configuración sin SSH: con cero usuarios, `login.html` pide el **código de instalación**
  (`CENSO_CODIGO_INSTALACION`) y crea el admin (`POST /api/instalacion`). `publico/admin.html`
  (solo admin): usuarios, dominio (`dominio.txt` → `censo-dominio.path` regenera Caddy), respaldo
  (`/api/exportar`) e importación (`/api/importar`, semilla o respaldo).
- `despliegue/`: `instalar.sh` (Ubuntu 24.04: Node, Caddy HTTPS, systemd, ufw),
  `Caddyfile`, `censo.service`, `censo.env.ejemplo`, `actualizar.sh`, `respaldo.sh`.
- Probar en local: `DATOS=/tmp/censo node servidor/servidor.js` → `http://localhost:3000`.

## Web pública del centro comercial (raíz del dominio)
La raíz `ccinmaculadaconcepcion.com/` es la **web para compradores** (sin sesión); el padrón
privado vive en **`/portal`** y se entra por **`/login`** (`/entrar` redirige).
- **Portada** (`servidor/publico/sitio/index.html` + `sitio.js`): carrusel de fotos
  (autoplay, puntos, flechas), **burbujas de categorías** (Mochilas, Carteras, Cartucheras…)
  que filtran ofertas y tiendas, **Las mejores ofertas** como **carrusel** (hasta 10 afiches;
  caben N tarjetas **enteras** por pantalla, `--n` en CSS: 4 / 3 / 2, nunca se ve una cortada;
  flechas siempre activas, puntos de página, avance automático cada 4 s que se detiene al tocar
  o al salir de pantalla y **vuelve al inicio** al llegar al final; filtros tipo/tienda/orden y
  aviso “Mostrando solo la categoría X · Ver todas” cuando hay filtro de categoría o búsqueda;
  al recargar no se conserva el filtro) terminado en una **burbuja redonda “Ver más”** que lleva a **`/ofertas`**
  (`ofertas.html` + `ofertas.js`: todas las ofertas en rejilla con filtros categoría, tipo,
  tienda, orden y búsqueda; los filtros van en la URL `?cat=&tipo=&tienda=&orden=&q=`), y
  **Tiendas**: las **más visitadas primero** (sello “Más visitada” en las 3 primeras), 8 en la
  portada y burbuja “Ver más tiendas” → **`/tiendas`** (`tiendas.html` + `tiendas.js`, filtro por
  categoría, orden más visitadas / más ofertas / nombre, búsqueda). Ya no hay secciones
  “Novedades” ni “Variedad de artículos”: en la web **solo se publican ofertas y promociones**
  (tipos: oferta, liquidación, campaña, **2 x 1**, **3 x 1**, combo, precio por mayor, lanzamiento;
  2 x 1 / 3 x 1 muestran la cifra “2x1” y cuentan como 50 % / 67 % al ordenar por descuento).
  El precio normal de etiqueta va en el catálogo de la tienda (en el artículo es opcional, sirve
  para el % de descuento). **El afiche tiene dos caras**: el frente muestra la oferta (banda del
  tipo, % o “2x1”, nombre, precios, foto con la pastilla “Ver tienda”); al tocarlo gira y el dorso
  muestra el **perfil de la tienda** (logo, nombre, stand, horario, categorías, descripción) con
  **Preguntar por WhatsApp** (mensaje ya escrito con el nombre, tipo y precio de la oferta) y, solo
  si la tienda cargó su **perfil digital externo** (`contactoUrl`), el botón que lo abre (el perfil
  interno `/tienda/:id` no se enlaza desde el afiche). Volver: botón, clic en el dorso o Esc.
  El carrusel se detiene mientras haya un afiche volteado. Lo compartido (afiche, tarjeta de
  tienda, burbuja, modal, cabecera) vive en `comun.js` (`S.afiche`, `S.afichesInteractivos`,
  `S.tarjetaTienda`, `S.burbujaMas`, `S.modalTienda`, `S.cabecera`).
- **Visitas al perfil** (colección `visitas`, solo la escribe el servidor): cada `GET /tienda/:id`
  cuenta una visita por visitante (hash ip+navegador) y hora; los clics al perfil digital externo
  avisan con `POST /api/publico/visita/:id` (beacon). Se guarda total + conteo por día (90 días);
  `/api/db/visitas` no admite escrituras. El editor muestra las visitas en la lista de tiendas.
- **Perfil digital de tienda** (`/tienda/:id`, `tienda.html`): WhatsApp con mensaje prellenado
  (y por artículo con `?art=`), llamar, catálogo (PDF o enlace), PDF de ofertas, **QR de pago**
  (imagen + texto Yape/Plin), cómo llegar, redes y botones extra; lista de ofertas y artículos.
- **Editor** (`/editar-sitio`, `editor.html` + `editor.js`): cualquier usuario con permiso de
  edición (enlace **Web pública** en la cabecera del portal y botón flotante “Editar esta web”
  cuando ya entró). Pestañas: datos del centro + carrusel (subir/ordenar/quitar fotos, texto
  y botón por foto), categorías (emoji + nombre, ocultar, ordenar), tiendas y artículos.
  El formulario de tienda es mínimo: nombre, stand, galería (`piso`), logo, horario,
  categorías, descripción, WhatsApp y **enlace al perfil digital** (`contactoUrl`); catálogo,
  QR de pago, redes, teléfono y otros botones ya no se editan (los detalles van en el perfil
  digital externo; si una tienda ya los tenía guardados, se conservan). Todo se guarda al instante.
- **Datos**: colecciones `sitio` (doc `config`: nombre, lema, dirección, horario, WhatsApp,
  `carrusel[]`, `categorias[]`), `tiendas` y `articulos` (mismos `/api/db`). Entran en el
  respaldo/importación. `lib/sitio.js` (`SitioPublico`) arma `GET /api/publico/sitio` y
  `GET /api/publico/tienda/:id` (sin campos internos: `propietarioId`, `notas`) y decide qué
  archivos de `/_blob/:id` pueden verse **sin sesión**: solo los referenciados por el carrusel,
  una tienda o un artículo publicados (el resto sigue exigiendo sesión).

## RENIEC en el padrón (actualizar y verificación masiva)
- En una ficha existente el botón junto al DNI es **«Actualizar desde RENIEC»** (`api/reniec.js`
  → `actualizarDesdeReniec`): guarda directo nombres, apellidos, fecha de nacimiento, dirección y
  distrito, más la foto del DNI si el plan la trae; sella `asociado.reniec.verificadoAt` (insignia
  "RENIEC" en la cabecera y ✓ en el padrón). Con datos simulados no cambia nada.
- Padrón → **«Verificar DNI con RENIEC»** (`VerificacionMasiva.js`): recorre los asociados con DNI
  válido (omite los ya verificados salvo que se marque la casilla), 2 consultas a la vez, barra de
  avance, botón Detener y lista de errores. Las repetidas salen de la caché del servidor.
- Padrón paginado de 25 en 25 (`Paginador.js`, `usePaginacion`).

## Peso de las imágenes y tope de ofertas (web pública)
- El editor **reduce cada imagen en el navegador** antes de subirla (`comprimirImagen` en `editor.js`):
  foto de artículo 1200 px, logo 600 px, QR 800 px (PNG si el original es PNG), carrusel 1920 px (web) y
  1350 px (celular), ícono de categoría 400 px; JPEG al 84–86 %. Una foto de celular de 4 MB queda en
  ~200 KB. El servidor rechaza (400) cualquier imagen pública que pese más de 2,5 MB (`MAX_IMAGEN_BYTES`,
  `validarPublico` con `tamanoArchivo`), por si alguien salta el editor.
- **Máximo 15 artículos en oferta por tienda** (`MAX_OFERTAS_POR_TIENDA`): el formulario muestra
  "Ofertas publicadas de esta tienda: n de 15" y bloquea, y el servidor vuelve a comprobarlo contando
  las ofertas visibles de la tienda (`ofertasDeTienda`). Los artículos sin oferta no tienen tope.

## Sin emojis en la web pública
La web no usa emojis: las categorías base llevan íconos de línea SVG (`ICONOS` en
`servidor/publico/sitio/comun.js`, `S.icono(clave)` / `S.iconoCategoria(c)`), una categoría nueva
muestra su inicial hasta que se le sube imagen, los botones del perfil y el buscador usan los mismos
íconos, y los tipos de oferta se distinguen por color (franja y punto en el chip). Las tarjetas de
tienda muestran la **descripción** recortada a 3 líneas con un "Ver más" que aparece solo cuando
el texto no cabe (medido en pantalla) y abre el resumen de la tienda.

## Tipos de oferta en la web pública
Un artículo en oferta lleva `tipoOferta` (oferta, liquidacion, campana, combo, mayorista, nuevo;
lista `TIPOS_OFERTA` en `servidor/lib/sitio.js`, expuesta como `sitio.tiposOferta`) y una
`etiquetaOferta` libre ("Campaña escolar 2027"). La portada tiene una barra de filtros en "Las mejores
ofertas" (tipo, tienda y orden: mayor descuento, menor/mayor precio, más recientes), cada afiche lleva una franja de color con el tipo y la **tienda** (logo, nombre y
stand) y un botón "Ver todas las ofertas" cuando hay más de 8. Seguridad del servidor: ver
`servidor/GUIA-AWS.md` § 7.

## Validación y datos de ejemplo de la web pública
- **Validación en dos capas**: el editor valida en el navegador (nombre obligatorio, WhatsApp de
  9 dígitos que empiece en 9, enlaces solo `https://`, precio de oferta menor que el normal…) y el
  servidor vuelve a validar cada PUT/PATCH de `tiendas`, `articulos` y `sitio` (`validarPublico` en
  `servidor/lib/sitio.js`; responde 400 con el mensaje). Los enlaces se pasan por `urlSegura`/`S.url`
  antes de pintarse: nunca se renderiza un `javascript:`.
- **Datos de ejemplo** (editor → Portada → "Cargar ejemplos"): genera en el navegador 3 banners
  (web y celular), 8 tiendas con logo, QR de ejemplo y WhatsApp, y 24 artículos con foto y ofertas
  de todos los tipos, marcados `ejemplo: true`. "Quitar ejemplos" los borra junto con sus archivos
  sin tocar lo cargado a mano. Pensado para la exposición a la directiva.

## Revertir un pago
En el cuadro anual (Pagos o pestaña Pagos de la ficha) una cuota pagada (✓) se puede tocar: se abre
el detalle (concepto, monto, medio, operación, fecha, quién lo registró) con **Revertir pago**
(confirmación en dos pasos y motivo opcional). La cuota vuelve a figurar pendiente/vencida y el
pago anulado **no se borra**: queda en `pagos/<stand>_<año>.anulaciones` con quién y cuándo lo
revirtió (`anularPago` en `src/api/pagos.js`, `anularRegistroPago` en `src/lib/db.js`); se lista
bajo el cuadro como "Pagos revertidos este año".

## Estado "Verificado" y observación de lo que falta
Una ficha pasa a **Verificado** automáticamente cuando sus datos se confirman con RENIEC
(botón **Actualizar desde RENIEC**, verificación masiva o la verificación nocturna). Al
arrancar, el servidor aplica la misma regla a las fichas ya verificadas (`lib/migraciones.js`,
idempotente; no toca fichas con discrepancia de apellido). La **observación** de lo que falta
(foto, huella, firma, copia del DNI, celular, dirección, fecha de nacimiento, autorización de
datos) se calcula al vuelo con `faltantes(a)` / `observacionFaltantes(a)` (`src/lib/padron.js`),
así desaparece sola al completar la ficha. Se muestra en la ficha (tarjeta "Estado de la
ficha"), en la lista del padrón ("falta: …") y en el CSV del padrón ("Observación (falta)").

## Verificación automática de DNI (servidor)
`servidor/lib/verificacion.js`: cada madrugada (hora de Lima, por defecto 00:30, `CENSO_VERIFICACION_HORA`)
recorre las fichas con DNI válido y sin `reniec.verificadoAt`, consulta al proveedor y guarda datos
(`camposDesdePersona`) y la foto del DNI solo si la ficha no tiene foto. Se detiene con 429 (límite del
proveedor) o 401 (token) y retoma al día siguiente; un DNI que "no figura" se anota (`reniec.intentos`) y
tras 3 intentos deja de probarse. Estado e historial en `DATOS/verificacion.json`. Rutas admin
`GET/POST /api/verificacion`, `POST /api/verificacion/ejecutar|detener`; panel en Administración.
