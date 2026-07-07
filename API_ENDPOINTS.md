# Referencia de endpoints del backend — Radar Tributar IA

Base: `https://radartributaria.com/api` (Next.js App Router — cada ruta vive en
`src/app/api/**/route.ts`). Total: **44 rutas**.

## Autenticación y convenciones

- **Sesión**: cookie firmada `rt_session` (HMAC-SHA256, 7 días). La emite el login
  y la valida el middleware (`src/middleware.ts`) en TODAS las rutas, salvo
  `/login`, `/reset` y `/api/auth/*`. Sin sesión → `401 {"error":"No autenticado"}`
  en API (redirect a /login en páginas).
- **Roles**: `supremo` (dueño de la plataforma) · `admin` (líder del estudio) ·
  `operador` (trabajador; hereda el estudio del admin vía `parentId`).
  `studioId(u) = u.parentId ?? u.id` — cada estudio ve SOLO sus clientes.
- **Errores**: siempre JSON `{ "error": "mensaje" }` con status HTTP
  (400 inválido, 401 sin sesión/clave SOL errada, 403 sin permiso, 404 no existe,
  409 conflicto (RUC duplicado), 429 cooldown/cuota).
- **Seguridad**: la **Clave SOL NUNCA se guarda** — viaja solo en el body de la
  consulta puntual. Usuario SOL + client_id/secret sí se guardan por cliente.
- **Cuotas** (módulo gratis): 3 extracciones por estudio cada 7 días (buzón /
  estado SIRE / F36). Una clave SOL incorrecta NO consume uso. Los módulos de
  paga (m2/m3/m4) los desbloquea el supremo por cuenta.
- **Cooldowns**: buzón y estado SIRE = 1/semana por empresa · F36 = cada 3 días.
  El admin puede forzar (`force`), el operador no.

---

## 1) Auth — `/api/auth/*` (sin sesión)

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/auth/register` | Crea la cuenta en estado **pendiente** (solicitud de acceso; no inicia sesión). Body: nombre, email, password. |
| POST | `/auth/login` | Valida credenciales + estado aprobado → set-cookie `rt_session`. |
| POST | `/auth/logout` | Borra la cookie de sesión. |
| POST | `/auth/forgot` | Envía correo de reset (token sha256 de un solo uso, vence 1 h). No revela si el email existe. |
| POST | `/auth/reset` | Fija nueva contraseña con el token del correo. |

## 2) Clientes (empresas del estudio) — `/api/clientes`

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/clientes` | Lista los clientes del estudio. |
| POST | `/clientes` | Crea cliente. **RUC único global** (409 si otro estudio ya lo registró). |
| GET | `/clientes/[id]` | Detalle de un cliente. |
| PATCH | `/clientes/[id]` | Edita datos de contacto. |
| DELETE | `/clientes/[id]` | Elimina la empresa. **Solo supremo o admin** (libera el RUC global; no repone usos gratis). |
| GET | `/clientes/export` | CSV de contactos (razón social, RUC, correo, celular). |
| POST | `/clientes/importar` | Carga masiva desde Excel (solo admin; respeta RUC único global). |
| POST/GET | `/clientes/verificar` | Verifica en SUNAT los clientes "por verificar" (lote, CAP 80, concurrencia 4). GET = cuántos faltan. |

## 3) Por cliente — `/api/clientes/[id]/*`

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `…/sunat` | Consulta RUC (decolecta) y persiste estado/condición/dirección. |
| PATCH | `…/sunat` | Guarda a mano fecha de inscripción / inicio de actividades (decolecta no las da). |
| POST | `…/credenciales` | Guarda Usuario SOL + client_id/client_secret del cliente (la Clave SOL no). |
| POST | `…/sire` | Consulta SIRE oficial (OAuth2): compras/ventas del periodo + presentado/no presentado. Body incluye claveSOL (no se guarda). |
| DELETE | `…/sire` | Borra los resúmenes SIRE guardados (para re-descargar otro rango). |
| GET | `…/sire-estado` | Estado de presentación SIRE guardado + fecha de última consulta. |
| POST | `…/sire-estado` | Actualiza el estado SIRE (cooldown semanal; admin puede forzar; consume uso gratis). |
| POST | `…/buzon` | Extrae el buzón SOL con navegador (clasifica peligroso/urgente). Cooldown + cuota. |
| POST | `…/declaraciones` | Sube PDF de declaración mensual (unpdf) → borrador editable; luego se confirma y compara vs SIRE. Soporta `noPresento` y modo `diagnostico=true`. |
| DELETE | `…/declaraciones` | Borra una declaración guardada. |
| POST | `…/declaraciones-anuales` | Sube PDF(s) de DJ anual (F-710) → comparativo año vs año. |
| DELETE | `…/declaraciones-anuales` | Borra una DJ anual. |
| POST | `…/deudas` | OCR (tesseract) de fotos de deudas → borradores; POST JSON confirma/guarda. |
| DELETE | `…/deudas` | Borra una deuda. |
| POST | `…/diagnostico` | Genera/regenera el diagnóstico (hallazgos + score). |
| GET | `…/informe/pdf` | Genera el informe en PDF con navegador headless (sin fecha/hora/URL del navegador). |
| GET | `…/documentos/[docId]/file` | Sirve el archivo original subido (vista previa/descarga). |

## 4) Consultas tributarias (módulo por empresa) — `/api/consultas/*`

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/consultas/buzon` | Devuelve el buzón guardado + cuándo se puede reconsultar. |
| POST | `/consultas/buzon` | Extrae el buzón (navegador). Cooldown 1/semana; clave SOL errada → 401 sin consumir uso. |
| POST | `/consultas/buzon/adjunto` | Descarga el PDF de UN mensaje (cache-first: si ya se bajó, no re-loguea). Registra quién y cuándo lo descargó. |
| POST/GET/PATCH | `/consultas/buzon/seguimiento` | Comentario de seguimiento por mensaje (aparece en el informe) / listar / marcar atendido. |
| POST | `/consultas/deudas/generar` | F36 fase 1: genera el pedido de deuda (Art. 36, Tesoro). 1 vez cada 3 días. |
| POST/GET | `/consultas/deudas/estado` | Verifica el estado del pedido en SUNAT (en proceso / listo). GET = guardado. |
| POST/GET | `/consultas/deudas/extraer` | F36 fase 2: extrae las 4 pestañas de deudas (cache 3 días). 0 filas = "sin deudas" (éxito). |

## 5) Herramientas sueltas (Inicio)

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/clasificacion` | Excel SIRE compras (RCE) → clasifica proveedor→cuenta (memoria + rubro decolecta). JSON `{accion:"guardar"}` aprende RUC→cuenta. |
| POST | `/clasificacion/excel` | Genera el Excel clasificado para Contasis. |
| POST | `/sire-ventas` | Excel/ZIP SIRE ventas (RVIE) → comprobantes con cuenta por defecto. |
| POST | `/cruce-sire` | Cruza SIRE vs Contasis (hasta 4 Excel) comprobante por comprobante. **Módulo de paga m2**. |
| POST | `/cruce-sire/excel` | Excel del comparativo (reusa el resultado calculado). |
| POST | `/masivo/excel` | Masivo compras/ventas en formato de importación Contasis. **Módulo m3**. |
| POST | `/facturas-xml` | XML/ZIP de comprobantes UBL → detalle completo (cabecera + ítems). `soloDetalle=1` sin clasificar; `soloGlosa=1` modo rápido para el masivo. |
| POST | `/facturas-xml/excel` | Excel del detalle (`detalle:true` = hojas Comprobantes + Ítems). |

## 6) Equipo y utilidades

| Método | Ruta | Qué hace |
|---|---|---|
| GET/POST/DELETE | `/usuarios` | Operadores del estudio (solo admin): listar, crear, eliminar. |
| GET | `/recordatorios` | Seguimientos de buzón vencidos/por vencer (banner de la Home). |
| GET | `/sunat/[ruc]` | Consulta RUC suelta (autollenado del alta de cliente). |

## 7) Supremo — `/api/supremo/*` (solo rol supremo)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/supremo/solicitudes` | Lista cuentas/solicitudes (filtro `?estado=`). |
| PATCH | `/supremo/solicitudes` | Aprueba/rechaza acceso · desbloquea módulos m2/m3/m4 · cambia contraseñas. |
| GET | `/supremo/operadores` | Detalle de operadores de una cuenta (`?adminId=`). |
| POST | `/supremo/reset` | Borra TODAS las cuentas y recrea el supremo (requiere `{confirmar:"ELIMINAR"}`). |
| GET/POST | `/supremo/navegador-url` | Ver (enmascarada) / guardar la URL del navegador remoto (Browserless). |

## 8) Diagnóstico (solo supremo)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/diagnostico/navegador?n=N` | Abre N navegadores a la vez: verifica conexión (local/remoto), concurrencia y estado de la **cola** (`colaNavegadores`). |
| POST | `/diagnostico/navegador` | Prueba una URL de Browserless directa `{ws, n}`. |
| POST | `/diagnostico/buzon-api` | Lab: token OAuth SUNAT + prueba de endpoints de la API "Control de mensajes" (incluye decodificación del JWT). |

---

### Notas para un desarrollador nuevo
- Handlers en `src/app/api/**/route.ts`; la lógica de negocio vive en `src/lib/*`
  (sunat.ts, sire.ts, buzon.ts, fraccionamiento.ts, declaracion.ts, db.ts…).
- Los datos se guardan vía `src/lib/db.ts` (JSON en disco persistente `/var/data`);
  para migrar a Postgres solo hay que reimplementar ese archivo.
- Extracciones con navegador pasan por la **cola global** (`src/lib/navegador.ts`,
  `MAX_NAVEGADORES`).
- Auditoría: las acciones relevantes se registran con `logAccion` (las ve el líder
  en /actividad).
