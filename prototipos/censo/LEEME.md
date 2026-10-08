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
  cookie firmada, roles admin/edicion/lectura), `lib/reniec.js` (apidni con caché).
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
  que filtran tiendas y artículos; cada tienda tiene **Ver ofertas** (resumen en ventana:
  artículos en oferta + botón Contactar) y **Contactar**; abajo, la **variedad de artículos**
  con “Vende: tienda · stand” y botón Contactar en cada uno. Filtro en la URL: `/?cat=mochilas`.
- **Perfil digital de tienda** (`/tienda/:id`, `tienda.html`): WhatsApp con mensaje prellenado
  (y por artículo con `?art=`), llamar, catálogo (PDF o enlace), PDF de ofertas, **QR de pago**
  (imagen + texto Yape/Plin), cómo llegar, redes y botones extra; lista de ofertas y artículos.
- **Editor** (`/editar-sitio`, `editor.html` + `editor.js`): cualquier usuario con permiso de
  edición (enlace **Web pública** en la cabecera del portal y botón flotante “Editar esta web”
  cuando ya entró). Pestañas: datos del centro + carrusel (subir/ordenar/quitar fotos, texto
  y botón por foto), categorías (emoji + nombre, ocultar, ordenar), tiendas y artículos
  (formularios con subida de logo, QR, PDF y foto). Todo se guarda al instante.
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

## Verificación automática de DNI (servidor)
`servidor/lib/verificacion.js`: cada madrugada (hora de Lima, por defecto 00:30, `CENSO_VERIFICACION_HORA`)
recorre las fichas con DNI válido y sin `reniec.verificadoAt`, consulta al proveedor y guarda datos
(`camposDesdePersona`) y la foto del DNI solo si la ficha no tiene foto. Se detiene con 429 (límite del
proveedor) o 401 (token) y retoma al día siguiente; un DNI que "no figura" se anota (`reniec.intentos`) y
tras 3 intentos deja de probarse. Estado e historial en `DATOS/verificacion.json`. Rutas admin
`GET/POST /api/verificacion`, `POST /api/verificacion/ejecutar|detener`; panel en Administración.
