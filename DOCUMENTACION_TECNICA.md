# Radar Tributar IA — Documentación técnica

> Plataforma web de diagnóstico tributario SUNAT para estudios contables (by **ASENCO**).
> Documento de revisión técnica y guía de mantenimiento/entrega.

---

## 1. Resumen

Aplicación web multiusuario que, por cada cliente (empresa con RUC), permite:

- Consultar el **estado del RUC** en SUNAT (razón social, estado, condición, domicilio).
- Leer el **buzón electrónico** SUNAT (notificaciones y mensajes) y descargar sus PDF.
- Consultar el **estado de presentación SIRE** (RVIE/RCE) y extraer los **montos** de compras/ventas.
- Generar y extraer las **deudas tributarias** del **Fraccionamiento Art. 36 (F36)**.
- Leer **declaraciones** mensuales y anuales (PDF) y compararlas contra el SIRE.
- Generar un **informe de gerencia** imprimible.
- Herramientas contables: **cruce SIRE vs Contasis** y **masivo SIRE → Contasis**.

La marca es **RADAR TRIBUTAR·IA · by ASENCO**.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|------------|
| Lenguaje | **TypeScript** (frontend y backend) |
| Framework | **Next.js 14** (App Router) sobre **React 18** |
| Runtime | **Node.js** |
| Estilos | **Tailwind CSS** |
| Scraping SUNAT | **playwright-core** + **@sparticuz/chromium** |
| Excel | **exceljs** |
| PDF | **unpdf** (pdf.js serverless) |
| OCR (deudas por foto) | **tesseract.js** |
| XML (facturas) | **fast-xml-parser** |
| Gráficos | **recharts** |
| Compresión | **fflate** |
| Correo | **Resend** (HTTP) |
| Hosting | **Render** (runtime node) |

---

## 3. Arquitectura general

- **Monolito Next.js**: el mismo proyecto sirve la UI (React Server/Client Components) y las **APIs** (route handlers en `src/app/api`).
- **Persistencia actual**: un único archivo **JSON** (`data/store.json`) gestionado por `src/lib/db.ts`. Los PDFs/archivos se guardan en `UPLOADS_DIR`.
- **Autenticación**: sesión por **cookie firmada (HMAC)**; contraseñas con **scrypt**. Sin estado de servidor.
- **Scraping**: el buzón y el fraccionamiento abren un **Chromium headless** (Playwright) y automatizan el portal SOL de SUNAT.
- **Integraciones HTTP**: RUC vía **decolecta**, SIRE vía **OAuth2** de SUNAT.

```
Navegador ─► Next.js (UI + API) ─► db.ts (store.json / uploads)
                     │
                     ├─► decolecta / apis.net.pe        (RUC, HTTP)
                     ├─► api-sire.sunat.gob.pe           (SIRE, OAuth2 HTTP)
                     └─► Chromium headless (Playwright)  (buzón, F36 — scraping SOL)
```

---

## 4. Estructura de carpetas

```
src/
├── app/                       # Páginas (page.tsx) y APIs (api/**/route.ts)
│   ├── page.tsx               # Inicio: menú de módulos (con bloqueo por módulo de paga)
│   ├── layout.tsx             # Shell: header responsive, providers, ensureSupremo
│   ├── login/ , reset/        # Auth (login/registro/olvido + reset por token)
│   ├── clientes/              # Lista, alta, importar Excel, detalle, informe, buzón
│   ├── herramientas/          # cruce-sire, procesar-compras, consultas, etc.
│   ├── equipo/ , actividad/   # Operadores del estudio · bitácora de auditoría
│   ├── supremo/               # Panel del usuario supremo
│   └── api/                   # Route handlers (ver §9)
├── components/                # 32 componentes (paneles y flujos de UI)
└── lib/                       # Lógica de dominio (ver §4.1)
```

### 4.1 Módulos de `src/lib`

| Archivo | Responsabilidad |
|---------|-----------------|
| `db.ts` | Store JSON: lectura/escritura, entidades, todos los setters. |
| `types.ts` | Tipos de dominio (Cliente, Usuario, SunatInfo, etc.). |
| `auth.ts` | Hash/verificación, sesión, roles, `ensureSupremo`, `modulosDelEstudio`. |
| `authToken.ts` | Firma/verificación de la cookie de sesión (HMAC). |
| `auditoria.ts` | `logAccion`: bitácora central (nunca rompe la acción). |
| `sunat.ts` | Consulta RUC (decolecta/apisnet/oficial/mock) + representantes. |
| `sire.ts` | SIRE OAuth2: estado de presentación y montos por periodo. |
| `buzon.ts` | Buzón vía Playwright (login SOL, listar, descargar PDF). |
| `fraccionamiento.ts` | F36 vía Playwright (generar / verificar / extraer). |
| `declaracion.ts` / `declaracionAnual.ts` | Lectura de PDF y comparativo vs SIRE / año vs año. |
| `diagnostico.ts` | Motor de hallazgos/score. |
| `clasificacion.ts` | Compras → cuenta contable automática. |
| `cruceSire.ts` / `xlsxIO.ts` / `sireExcel.ts` | Cruce SIRE vs Contasis + IO Excel. |
| `facturaXml.ts` / `ocr.ts` / `zip.ts` | XML de facturas · OCR de deudas · ZIP. |
| `modulos.ts` | Definición de módulos de paga (m2/m3/m4). |
| `email.ts` | Envío de correo (Resend). |
| `solSession.ts` | Clave SOL solo en sessionStorage del navegador. |

---

## 5. Modelo de datos

El store (`Store`) contiene: `clientes[]`, `users[]`, `acciones[]` (bitácora),
`cuentasProveedor`, `rubrosProveedor`.

### 5.1 `Cliente`
RUC único por estudio. Campos principales:
`id, ownerId (=estudio), razonSocial, ruc, email, telefono, sunat (SunatInfo|null),
credSire (Usuario SOL + API, sin Clave), sire[] (montos por periodo), buzon,
buzonAdjuntos (caché PDF + quién/cuándo descargó), seguimientosBuzon[] (comentarios),
declaraciones[], declaracionesAnuales[], deudas[] (OCR), deudasF36 (tablas + estado),
diagnostico`.

`SunatInfo`: `estado, condicion, tipoContribuyente, direccion, fechaInscripcion?,
fechaInicioActividades?, representantes?[], tributos[], fuente, consultadoAt`.

### 5.2 `Usuario`
`id, nombre, email, passHash, createdAt, rol ("supremo"|"admin"|"operador"),
parentId? (operador → su admin), estado ("pendiente"|"aprobado"|"rechazado"),
modulos[] (paga desbloqueados), resetTokenHash?/resetTokenExp? (recuperación)`.

> ⚠️ La **Clave SOL nunca se persiste**: vive solo en `sessionStorage` del navegador
> (`solSession.ts`) y se envía por petición al extraer.

---

## 6. Autenticación, roles y permisos

- **Sesión**: cookie HMAC (`authToken.ts`); contraseñas con `scrypt` (`auth.ts`).
- **Registro = solicitud**: crea la cuenta en estado **pendiente** (no inicia sesión).
  El **supremo** la aprueba/rechaza. Cuentas antiguas (sin `estado`) entran (compat.).

### Roles
| Rol | Alcance |
|-----|---------|
| **supremo** | Dueño de la plataforma. Aprueba cuentas, desbloquea módulos, cambia contraseñas, ve Modo diagnóstico. Sembrado por `ensureSupremo` (env `SUPREMO_EMAIL/PASSWORD`, auto-reparador). |
| **admin** | Líder de un estudio. Crea/elimina empresas, edita API, gestiona operadores (Equipo). |
| **operador** | Trabajador del estudio (`parentId`=admin). Todo **menos** crear/eliminar empresa y editar/borrar API. |

- **`studioId(user)`** = `parentId ?? id` → define qué empresas ve.
- **Módulos de paga** (`m2` Comparativo SIRE, `m3` Masivo Contasis, `m4` Consultas
  tributarias) se desbloquean por estudio desde el panel supremo; `modulosDelEstudio`
  resuelve los activos (operadores heredan del admin). El **módulo 1** es libre.

---

## 7. Integraciones SUNAT

### 7.1 RUC (`sunat.ts`)
- Proveedor por defecto **decolecta** (`/v1/sunat/ruc/full`, `DECOLECTA_TOKEN`).
- ⚠️ decolecta **no entrega** fecha de inscripción/inicio de actividades → se ingresan
  a mano (campo opcional) y `setSunatInfo` las preserva al re-consultar.

### 7.2 SIRE (`sire.ts`) — OAuth2
- Credencial del contribuyente con alcance **"Desktop"** (no "Web").
- Token: `POST api-seguridad.sunat.gob.pe/.../oauth2/token` (grant_type=password).
- **codLibro**: VENTAS (RVIE) = `140000`, COMPRAS (RCE) = `080000`.
- **Estado de presentación**: endpoint `omisos/{codLibro}/periodos`.
- **Montos**: `rvierce/resumen/.../exporta`. Requiere la API (client_id/secret).

### 7.3 Buzón (`buzon.ts`) — Playwright
- Login SOL → cerrar campaña "Valida tus datos" → abrir buzón → `fetch` interno
  `listNotiMenPag` (tipoMsj 2 = Notificaciones, 1 = Mensajes).
- Toma los últimos 6 de cada uno; descarga PDF por mensaje (clip o impresión/texto).
- Límite **1 consulta/día por empresa**; se persiste para no perderlo al refrescar.

### 7.4 Fraccionamiento F36 (`fraccionamiento.ts`) — Playwright
- Proceso **asíncrono en 2 fases**:
  1. **Generar** pedido (Generación de pedido de deuda → Entidad TESORO → Enviar) →
     pantalla "Número de Pedido F36".
  2. SUNAT procesa (tiempo variable) → **Verificar estado** hasta "Pendiente de
     Elaborar Solicitud" → **Extraer** las 4 pestañas de deudas.
- Contempla el aviso **"La aplicación ha retornado el siguiente mensaje"** (p. ej.
  *"Tiene deuda pendiente por Perdida"*): captura el **texto en rojo** y lo muestra.
- Navegación con **reintento** y **tope de tiempo** (220 s) para no colgarse.

> Solo **buzón** y **fraccionamiento** requieren únicamente **Usuario + Clave SOL**.
> El **estado/montos SIRE** requieren además la **API** (client_id/secret).

---

## 8. Módulos funcionales

1. **Reporte analítico de auditoría** (libre) — `/clientes`: alta/consulta de empresas,
   buzón, estado SIRE, fraccionamiento, declaraciones, informe de gerencia.
2. **Comparativo SIRE vs sistema contable** (paga · m2) — `/herramientas/cruce-sire`.
3. **Masivo SIRE → Contabilidad (Contasis)** (paga · m3) — `/herramientas/procesar-compras`.
4. **Consultas tributarias** (paga · m4) — `/herramientas/consultas`: buzón + F36.

Otras pantallas: **Equipo** (operadores), **Actividad** (bitácora), **Supremo**
(solicitudes, módulos, contraseñas, operadores), **Importar Excel**, **Informe**.

---

## 9. APIs principales (`src/app/api`)

| Ruta | Uso |
|------|-----|
| `auth/{login,register,logout,forgot,reset}` | Sesión y recuperación de contraseña. |
| `clientes` (GET/POST) · `clientes/[id]` (GET/PATCH/DELETE) | CRUD de empresas (alta y borrado solo admin/supremo). |
| `clientes/importar` | Carga masiva desde Excel (RUC + Usuario SOL + API). |
| `clientes/verificar` | Verifica en SUNAT las empresas pendientes (por lotes). |
| `clientes/[id]/{sunat,sire,sire-estado,credenciales,...}` | Datos por empresa. |
| `consultas/buzon{,/adjunto,/seguimiento}` | Buzón: extraer, descargar PDF, comentarios. |
| `consultas/deudas/{generar,estado,extraer}` | Fraccionamiento F36 (3 fases). |
| `sunat/[ruc]` | Consulta RUC (`?debug=1` = respuesta cruda de decolecta). |
| `supremo/{solicitudes,operadores,reset}` | Panel supremo (gated a rol supremo). |
| `usuarios` | Operadores del estudio (admin). |
| `recordatorios` · `actividad`* | Recordatorios de buzón · bitácora. |

\* La bitácora se consulta desde la página `/actividad` (server), no por API pública.

---

## 10. Persistencia y despliegue

- **Render**, runtime node. Despliega desde la rama **`main`** (mantener `main` y la
  rama de trabajo sincronizadas).
- **Datos**: `data/store.json` en `DATA_DIR`. **Sin disco persistente, los datos se
  borran en cada deploy** → usar un disco/volumen para producción.
- **Build obligatorio antes de push**: `npm run build` debe pasar.

### 10.1 Variables de entorno (Render → Environment)
| Variable | Para |
|----------|------|
| `DATA_DIR`, `UPLOADS_DIR` | Rutas de datos/archivos. |
| `AUTH_SECRET` | Firma de la cookie de sesión. |
| `DECOLECTA_TOKEN` (`DECOLECTA_URL`, `..._REPRESENTANTES_URL`) | Consulta RUC. |
| `SUNAT_PROVIDER`, `APISNET_TOKEN`, `SUNAT_FORCE_MOCK` | Fuente RUC alterna/mock. |
| `SIRE_*` | Endpoints/códigos del SIRE (tienen valores por defecto). |
| `SUPREMO_EMAIL`, `SUPREMO_PASSWORD`, `SUPREMO_NOMBRE` | Cuenta supremo (override). |
| `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` | Correo de recuperación (opcional). |
| `APP_URL` | Base para los enlaces de los correos. |

---

## 11. Seguridad

- **Clave SOL**: nunca en BD; solo en `sessionStorage`. En la cola/extracción viaja
  por petición y no se guarda.
- **Cookie** httpOnly, sameSite=lax, `secure` en producción.
- **Recuperación de contraseña**: token aleatorio, se guarda **hasheado** (sha256),
  un solo uso, expira en 1 hora; no revela si el correo existe.
- **Gating por rol** en servidor (crear/eliminar empresa, editar API, panel supremo,
  módulos de paga). El **Modo diagnóstico** solo lo ve el supremo.
- **Trazabilidad**: `logAccion` registra acciones clave (buzón, PDF, seguimientos,
  F36, credenciales, crear/eliminar empresa, importación, cambios de contraseña).

---

## 12. Escalabilidad (estado y plan)

**Cuellos de botella actuales:**
1. **Store JSON** sin bloqueo → riesgo con escrituras concurrentes. Plan: **Postgres**
   (misma interfaz de `db.ts`).
2. **Chromium headless** (buzón/F36): ~300–700 MB cada uno → 1–2 simultáneos en 2 GB.
   Plan: **cola de trabajos** + flota de workers / servicio de navegadores gestionado.
3. **Archivos** en disco local → mover a **almacenamiento de objetos** (S3/R2).

**Para miles de usuarios**: Postgres + cola/offload de navegadores + web stateless con
autoescalado + objetos para PDFs. Techo externo: **límites de SUNAT** (logins masivos).

---

## 13. Cómo correr localmente

```bash
npm install
# crear data/ y configurar variables mínimas (DATA_DIR opcional, DECOLECTA_TOKEN, AUTH_SECRET)
npm run dev            # desarrollo en http://localhost:3000
npm run build          # debe pasar antes de cualquier push
npm start              # producción local
```

- Primer ingreso: la cuenta **supremo** se siembra automáticamente con
  `SUPREMO_EMAIL`/`SUPREMO_PASSWORD` (o sus valores por defecto en `auth.ts`).
- **Modo diagnóstico** (solo supremo): cada módulo SUNAT muestra la respuesta cruda
  para calibrar endpoints sin adivinar.

---

## 14. Convenciones

- `npm run build` debe pasar antes de subir (verificar `Failed to compile`).
- Probar cambios SUNAT con **Modo diagnóstico** (probe por módulo).
- Commits con `Co-Authored-By` y `Claude-Session`.
- El código y los comentarios están en **español**.

---

_Documento generado para revisión técnica del proyecto Radar Tributar IA (by ASENCO)._
