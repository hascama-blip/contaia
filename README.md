# ContaIA

Plataforma web para estudios contables / de auditoría que permite, por cada cliente:

1. **Consultar el estado tributario en SUNAT** (API oficial vía OAuth2 con Clave SOL, con modo simulado de respaldo).
2. **Subir documentos o fotos** (comprobantes, declaraciones, notificaciones) y extraer datos con **OCR** (RUC, montos, deudas, palabras clave).
3. **Generar un diagnóstico** automático de salud tributaria combinando SUNAT + documentos.
4. **Visualizar un dashboard** con el estado de toda la cartera.
5. **Generar un informe** imprimible / exportable a PDF para el cliente.

## Stack

- **Next.js 14** (App Router) + **TypeScript**
- **TailwindCSS** para la UI
- **Recharts** para los gráficos del dashboard
- **tesseract.js** para OCR (WASM, sin binarios nativos)
- Almacenamiento en archivo JSON local (`data/store.json`) — sustituible por una BD real

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # opcional: configurar credenciales SUNAT
npm run dev                  # http://localhost:3000
```

Para producción:

```bash
npm run build
npm run start
```

## Integración SUNAT

La capa `src/lib/sunat.ts` soporta **tres fuentes** y elige automáticamente
(`SUNAT_PROVIDER=auto`) la mejor disponible:

1. **apis.net.pe** (fuente externa, recomendada por su facilidad) — solo necesita un token.
2. **API oficial SUNAT (SOL)** — OAuth2 con Clave SOL.
3. **Simulado** — datos de ejemplo deterministas por RUC, si no hay credenciales.

El campo `fuente` (`externo` | `oficial` | `simulado`) indica el origen del dato,
y el dashboard muestra la fuente activa.

### Opción A — apis.net.pe (más fácil)

1. Regístrate gratis en https://apis.net.pe y copia tu token.
2. En `.env.local`:

```
APISNET_TOKEN=tu_token_aqui
```

¡Listo! El buscador de RUC jalará datos reales de SUNAT.

### Opción B — API oficial SUNAT (SOL)

```
SUNAT_CLIENT_ID=...
SUNAT_CLIENT_SECRET=...
SUNAT_RUC=...
SUNAT_SOL_USER=...
SUNAT_SOL_PASS=...
```

> **Modo simulado:** si no se configuran las credenciales (o `SUNAT_FORCE_MOCK=true`),
> la app genera datos de ejemplo deterministas por RUC para que todo el flujo sea
> usable sin credenciales. El campo `fuente` (`oficial` | `simulado`) indica el origen
> del dato, y el dashboard muestra el modo activo.

Los endpoints por defecto apuntan a producción de SUNAT; ajústalos según el servicio
contratado por tu estudio.

## Flujo de uso

1. **Nuevo cliente** → razón social + RUC.
2. En la ficha del cliente: **Consultar SUNAT**, **Subir documentos**, **Generar diagnóstico**.
3. **Generar informe** → vista imprimible (botón *Imprimir / Guardar PDF*).

## Estructura

```
src/
  app/
    page.tsx                       Dashboard
    clientes/                      Lista, alta, ficha e informe del cliente
    api/clientes/...               Backend (REST): clientes, SUNAT, documentos, diagnóstico
  lib/
    sunat.ts                       Integración SUNAT (oficial + simulado)
    ocr.ts                         OCR y extracción de datos
    diagnostico.ts                 Motor de diagnóstico tributario
    db.ts                          Persistencia (JSON)
    types.ts                       Tipos de dominio
  components/                      UI, dashboard, ficha del cliente, informe
```

## Notas

- Los archivos subidos se guardan en `data/uploads/` y no se versionan.
- El OCR procesa imágenes (PNG/JPG/WEBP). Los PDF se almacenan; su OCR puede añadirse
  con una etapa de rasterizado.
- El informe debe ser validado por un contador/auditor colegiado antes de su uso formal.
