# Censo C.C. "Inmaculada Concepción" — prototipo

Prototipo publicado como página privada en Claude (no está en Render).
Estilo y organización por capas copiados de Radar Tributar·IA.

## Capas (igual que Radar)

| Carpeta | Papel | Equivalente en Radar |
|---|---|---|
| `src/config.js` | Galerías, cuotas, listas y regla de 3 incidencias | mapas ajustables (`REGLAS_CUENTA`, `MAPA_CASILLAS`) |
| `src/plano.js` | **Distribución del plano** (un solo piso). Es lo único a cambiar con el plano real | — |
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

## Plano

`src/plano.js` describe bloques: `corredor` (pasillo con stands a ambos lados),
`fila` (stands en línea) o `stands` (lista explícita `{codigo, x, y, w, h}` para
formas irregulares), más ambientes e ingresos. `lib/plano.js` calcula la posición
de cada stand y su color; `components/Plano.js` dibuja el SVG y la burbuja con
"Ver detalle". El plano actual es **de ejemplo** (10 galerías: A–H, Patio de
comidas y Pabellón de servicios). Con el plano real: se calca en `plano.js`
(o se pasa la foto/PDF del plano para trazarlo) y el resto no cambia.

## Documentos

Cada asociado guarda `documentos: [{id, nombre, archivo, tipo, tamano, subidoAt}]`.
El nombre visible sale del archivo (`Contrato_compraventa_A-02.pdf` →
"Contrato compraventa A-02") y se puede renombrar. Acepta PDF, fotos y texto;
Word/Excel no (se pide guardarlos como PDF).

## Datos

Colecciones: `asociados`, `stands` (id = código, p. ej. `A-12`; el dueño está en
`propietarioId`), `pagos` (id = `A-12_2026`, `registros["mantenimiento-09"]`),
`incidencias`. Los registros con `ejemplo: true` se vacían desde **Reportes**.

## Tecnología

React 18 + htm (plantillas `html\`…\`` sin compilación), cargados desde CDN.
PDF de la ficha con jsPDF (se carga al pedir el PDF).
