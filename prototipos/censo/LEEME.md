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

## Datos

Colecciones: `asociados`, `stands` (id = número del plano, p. ej. `1091`; el dueño está en
`propietarioId`, los anteriores en `historial`), `pagos` (id = `1091_2026`, `registros["mantenimiento-09"]`),
`incidencias`. Los registros con `ejemplo: true` se vacían desde **Reportes**.

## Tecnología

React 18 + htm (plantillas `html\`…\`` sin compilación), cargados desde CDN.
PDF de la ficha con jsPDF (se carga al pedir el PDF).
