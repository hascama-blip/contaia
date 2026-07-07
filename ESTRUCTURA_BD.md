# Estructura completa de la base de datos — Radar Tributar IA

Fuente de verdad: `src/lib/types.ts` (entidades) + `src/lib/db.ts` (raíz `Store` y acceso).
Motor actual: **JSON en disco persistente** (`/var/data`). Al final está el mapeo sugerido
a Postgres (Fase 2).

## Archivos físicos (en el disco `/var/data`)

| Ruta | Contenido |
|---|---|
| `store.json` | **Toda la base de datos** (el objeto `Store` de abajo). |
| `uploads/` | Archivos binarios: PDFs del buzón, documentos subidos. |
| `backups/store-YYYY-MM-DD.json` | Snapshot automático diario del store (últimos 14). |

---

## Raíz: `Store`

| Campo | Tipo | Descripción |
|---|---|---|
| `clientes` | `Cliente[]` | Las empresas registradas (cada una pertenece a un estudio). |
| `users` | `Usuario[]` | Cuentas que inician sesión (supremo, admins, operadores). |
| `cuentasProveedor` | `Record<ruc, ProveedorCuenta>` | Memoria RUC→cuenta contable (clasificación de compras). |
| `rubrosProveedor` | `Record<ruc, {razonSocial, actividad, at}>` | Caché de rubro por RUC (decolecta se consulta 1 vez). |
| `acciones` | `AccionAuditoria[]` | Bitácora de auditoría (tope 5,000; la ve el líder). |
| `rucsRegistrados` | `Record<ruc, {studioId, clienteId, ownerNombre?, at}>` | Registro GLOBAL de RUCs tomados (un RUC = un solo estudio en toda la plataforma; anti-abuso). |
| `config` | `{ browserWsUrl?: string }` | Configuración global (URL de Browserless del supremo). |

---

## `Usuario` (cuentas de acceso)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | UUID. |
| `nombre` | string | |
| `email` | string | Único (login). |
| `passHash` | string | **scrypt** — nunca se guarda la contraseña en claro. |
| `createdAt` | string ISO | |
| `rol` | `"supremo" \| "admin" \| "operador"` | supremo = dueño de la plataforma; admin = líder de estudio. |
| `parentId` | string? | Id del admin dueño (solo operadores). `studioId = parentId ?? id`. |
| `estado` | `"pendiente" \| "aprobado" \| "rechazado"` | El registro queda pendiente hasta que el supremo apruebe. |
| `decididoAt` | string? | Cuándo decidió el supremo. |
| `modulos` | string[]? | Módulos de paga desbloqueados: `"m2"`, `"m3"`, `"m4"`. |
| `resetTokenHash` / `resetTokenExp` | string? | Reset de contraseña: hash sha256 del token, un solo uso, vence 1 h. |
| `usosGratis` | `{usados: number, desde: string}` | Cuota del módulo gratis: 3 extracciones / 7 días por estudio. |

## `Cliente` (empresa de un estudio)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | UUID. |
| `ownerId` | string | Estudio dueño (`studioId`). Aislamiento total entre estudios. |
| `razonSocial`, `ruc`, `email`, `telefono` | string | RUC único global. |
| `createdAt` | string ISO | |
| `sunat` | `SunatInfo \| null` | Resultado de la consulta RUC. |
| `documentos` | `Documento[]` | (legacy OCR de documentos). |
| `diagnostico` | `Diagnostico \| null` | Score + hallazgos + recomendaciones. |
| `sire` | `SireResumen[]` | Montos compras/ventas por periodo. |
| `sireEstado` | `{estados[], at} \| null` | Presentado/no presentado por periodo (con fecha de consulta). |
| `buzon` | `BuzonResumen \| null` | Última extracción del buzón. |
| `buzonAdjuntos` | `Record<codMensaje, AdjuntoCache>` | PDFs ya bajados (cache) + quién/cuándo los descargó. |
| `seguimientosBuzon` | `SeguimientoBuzon[]` | Comentarios/plazos por mensaje. |
| `declaraciones` | `DeclaracionMensual[]` | DJ mensuales (PDF/manual, con `noPresento`). |
| `declaracionesAnuales` | `DeclaracionAnual[]` | DJ anuales F-710 (casilla→monto). |
| `deudas` | `Deuda[]` | Deudas por OCR de fotos o manuales. |
| `deudasF36` | objeto \| null | Fraccionamiento Art. 36 (ver abajo). |
| `credSire` | `CredencialesSire \| null` | Usuario SOL + client_id/client_secret. **La Clave SOL NUNCA se guarda.** |

### Sub-entidades del Cliente

**`SunatInfo`** — `ruc, razonSocial, estado, condicion, tipoContribuyente, direccion,
fechaInscripcion?, fechaInicioActividades?, tributos[], comprobanteElectronico,
representantes[]? (tipoDoc, numeroDoc, nombre, cargo, desde), fuente ("oficial"|"externo"|"simulado"), consultadoAt`.

**`SireResumen`** — `periodo "YYYYMM", ventas: SireBloque, compras: SireBloque,
presentadoVentas, presentadoCompras, fuente, consultadoAt`.
`SireBloque` = `comprobantes, baseImponible, igv, inafectoExonerado, importeTotal`.

**`BuzonResumen`** — `peligrosos[], urgentes[], mensajes[]?, totalMensajes, consultadoAt`.
`BuzonMensaje` = `id (codMensaje), fecha, asunto, tipo, nivel ("peligroso"|"urgente"|"otro"),
urgente, leido, origen ("notificaciones"|"mensajes"), adjuntos (nº)`.

**`AdjuntoCache`** — `archivo (nombre en uploads/), nombre (para descargar), at, size,
descargadaAt?, descargadoPorId?, descargadoPorNombre?`.

**`SeguimientoBuzon`** — `codMensaje, asunto, fecha, origen?, diasAtencion, comentario,
creadoAt, fechaLimite, atendido?, creadoPorId?, creadoPorNombre?`.

**`DeclaracionMensual`** — `id, periodo "YYYYMM", ruc?, formulario?, ventasBase, ventasIgv,
ventasDetalle[]?, comprasBase, comprasIgv, comprasDetalle[]?, casillas[] (codigo→monto),
fuente ("pdf"|"manual"), archivoNombre?, cargadoAt, noPresento?`.

**`DeclaracionAnual`** — `id, ejercicio "YYYY", ruc?, razonSocial?, formulario?,
valores Record<casilla, monto>, fuente, archivoNombre?, cargadoAt`.

**`Deuda`** — `id, tipo, seccion?, codigoTributo?, numero?, descripcion, monto, periodo?,
entidad?, fuente ("ocr"|"manual"), ocrTexto?, creadoAt`.

**`deudasF36`** — `tablas: DeudaF36Tabla[] (pestana, headers[], filas[][]), at?, generadoAt?,
nota?, numPedido?, fechaPedido?, estado ("sin-pedido"|"en-proceso"|"listo"|"extraido"|"vencido"),
estadoTexto?, accion?, verificadoAt?`.

**`CredencialesSire`** — `solUser, clientId, clientSecret, guardadoAt`. (Sin Clave SOL.)

**`Diagnostico`** — `score 0-100, nivelRiesgo, hallazgos[] (tipo, severidad, titulo, detalle),
recomendaciones[], generatedAt`.

**`Documento`** (legacy) — `id, clienteId, originalName, storedName, mimeType, size,
uploadedAt, ocrText, ocrStatus, extraccion {ruc?, montos[], deudas[], fechas[], palabrasClave[]}`.

## `ProveedorCuenta` (memoria de clasificación, a nivel plataforma)

`ruc, razonSocial?, rubro?, cuenta, nombreCuenta?, fuente ("aprendido"|"sugerido"), actualizadoAt`.

## `AccionAuditoria` (bitácora)

`id, at, studioId, usuarioId, usuarioNombre, rol?, area (Buzón/Fraccionamiento/Cliente/…),
accion (verbo+objeto), clienteId?, clienteNombre?, detalle?`. Tope: 5,000 entradas (FIFO).

---

## Mapeo sugerido a Postgres (Fase 2)

| Tabla | Origen en el store | Clave |
|---|---|---|
| `usuarios` | `users[]` | `id` PK, `email` UNIQUE, `parent_id` FK→usuarios |
| `clientes` | `clientes[]` (campos planos + `sunat` y `diagnostico` como JSONB) | `id` PK, `owner_id` FK, `ruc` UNIQUE |
| `sire_resumenes` | `cliente.sire[]` | PK (`cliente_id`, `periodo`) |
| `sire_estados` | `cliente.sireEstado.estados[]` | PK (`cliente_id`, `periodo`) |
| `buzon_mensajes` | `cliente.buzon.mensajes[]` | PK (`cliente_id`, `cod_mensaje`) |
| `buzon_adjuntos` | `cliente.buzonAdjuntos{}` | PK (`cliente_id`, `cod_mensaje`) |
| `buzon_seguimientos` | `cliente.seguimientosBuzon[]` | PK (`cliente_id`, `cod_mensaje`) |
| `declaraciones_mensuales` | `cliente.declaraciones[]` (detalle/casillas JSONB) | `id` PK |
| `declaraciones_anuales` | `cliente.declaracionesAnuales[]` (valores JSONB) | `id` PK |
| `deudas` | `cliente.deudas[]` | `id` PK |
| `deudas_f36` | `cliente.deudasF36` (tablas JSONB) | `cliente_id` PK |
| `cred_sire` | `cliente.credSire` | `cliente_id` PK (cifrar `client_secret`) |
| `cuentas_proveedor` | `cuentasProveedor{}` | `ruc` PK |
| `rubros_proveedor` | `rubrosProveedor{}` | `ruc` PK |
| `acciones` | `acciones[]` | `id` PK, índice (`studio_id`, `at`) |
| `rucs_registrados` | `rucsRegistrados{}` | `ruc` PK |
| `config` | `config` | fila única (o tabla clave-valor) |

Notas de migración: el backup JSON (`/api/supremo/backup?solo=datos`) es exactamente la
fuente a importar; todo el acceso pasa por `db.ts`, así que solo se reimplementa ese archivo.
