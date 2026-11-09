# ASENCOIA — Plataforma de diagnóstico tributario SUNAT

Contexto de proyecto para Claude Code. **Leer esto primero** al retomar el trabajo.

## Qué es
App web (Next.js 15 App Router + React 19 + TypeScript + Tailwind) para un estudio contable.
Por cada cliente: consulta estado SUNAT (RUC), SIRE (compras/ventas), buzón
electrónico, lectura de declaraciones (PDF) y comparativo vs SIRE, diagnóstico, dashboard
e **informe de gerencia** (PDF).

Marca: **ASENCO** (azul `brand-700`) + **IA** (negro). Logo cuadrado "A".

## Despliegue
- **Render**, runtime **node**, plan **standard** (2 GB — el buzón usa navegador headless).
- Branch de trabajo y `main` se mantienen iguales (push a ambos).
- Datos en `data/store.json` (JSON local). En Render **sin disco persistente los datos
  se borran en cada deploy** → al probar, recrear el cliente. (Activar disco = plan con disco.)
- Variables clave (Render → Environment): `DECOLECTA_TOKEN`. El **usuario SOL + API
  (client_id/secret)** se **guardan por cliente** (`Cliente.credSire`, setter `setCredSire`)
  y se prellenan; la **Clave SOL NUNCA se guarda** (se escribe en cada consulta).
- **RUC único**: no se permite crear dos clientes con el mismo RUC (chequeo en
  `POST /api/clientes` con `getClienteByRuc`, responde 409). Unicidad **global** entre estudios
  (`duenoDeRuc` / `rucsRegistrados`): un RUC tomado por otro estudio no se puede registrar,
  **salvo el supremo y la cuenta "Utilitarios RTP"** (`exentoUnicidadRuc`; sus módulos son propios),
  que pueden registrarlo igual sin adueñarse (no entra al registro global,
  sus copias no bloquean a nadie y borrarlas no libera el RUC del dueño; queda en la bitácora). La razón social verificada por
  SUNAT queda **bloqueada** (read-only) en el alta. Export de contactos: `GET /api/clientes/export` (CSV).
- **Editar empresa** (`PATCH /api/clientes/[id]`): lista blanca (razonSocial, email, telefono, negocio, ruc).
  Cambiar el RUC (solo admin) aplica las reglas del alta (duplicado propio, dueño global salvo supremo),
  mueve el registro global y borra los datos SUNAT del RUC anterior (`updateCliente`). La cuenta
  "Utilitarios RTP" edita/elimina desde su lista (`EmpresasRtp.tsx`: RUC con "Consultar SUNAT",
  razón social y Usuario SOL).
- Commits terminan con `Co-Authored-By` y `Claude-Session` (ver git log).

## Arquitectura
- **Diagnóstico y hoja de ruta**: ver `ARQUITECTURA.md` (veredicto: monolito OK; la
  cola global de navegadores en `src/lib/navegador.ts` protege la web — `MAX_NAVEGADORES`
  default 2; Fase 2 = migrar a Postgres antes de un lanzamiento masivo).
- `src/lib/db.ts` — store JSON. Entidad `Cliente` con: sunat, documentos (legacy), diagnostico,
  sire[], buzon, declaraciones[]. Setters: setSunatInfo, setSireResumen, setBuzon,
  setDiagnostico, addDeclaracion, deleteDeclaracion.
- `src/lib/types.ts` — tipos de dominio.
- `src/lib/sunat.ts` — consulta RUC. Proveedores: decolecta (default, token), apisnet, oficial SOL, mock. `SUNAT_PROVIDER=auto`.
- `src/lib/sire.ts` — SIRE (OAuth2). Ver detalle abajo.
- `src/lib/buzon.ts` — buzón vía **Playwright** (scraping del portal SOL). Ver abajo.
- `src/lib/declaracion.ts` — lee PDF de declaración mensual (**unpdf**, sin OCR) y la
  **compara con el SIRE** del mismo periodo. (Reemplazó al OCR/tesseract, ya eliminado.)
- `src/lib/declaracionAnual.ts` — lee PDF de **DJ anual (Formulario 710)** y arma el
  **comparativo año vs año** (Estados Financieros + Estado de Resultados). Parser
  "dirigido por casilla" (busca cada código de 3 dígitos y su monto vecino, maneja
  montos pegados al código tipo `78736359`). Detecta ejercicio (RENTA ANUAL YYYY / periodo
  YYYY13), RUC y razón social; resalta variaciones grandes como observaciones y avisa si el
  RUC del PDF ≠ el del cliente (posible cruce). `MAPA CASILLAS_710` (en el archivo) es ajustable.
- `src/lib/ocr.ts` — **OCR (tesseract.js)** para fotos de **deudas tributarias**: extrae texto,
  montos, claves y sugiere tipo de deuda. Panel `DeudasPanel.tsx`, ruta `deudas/route.ts`,
  entidad `Deuda` en types/db. (El OCR se reintrodujo solo para deudas; las DJ siguen por unpdf.)
- `src/lib/clasificacion.ts` — **Compras → cuenta automática**: clasifica cada proveedor por su
  **rubro** (actividad económica de decolecta, `consultarActividad` en sunat.ts) + reglas
  `REGLAS_CUENTA` (ajustables). Memoria **RUC→cuenta** a nivel estudio (`Store.cuentasProveedor`,
  `get/setCuentasProveedor`): lo confirmado se aprende. Panel `ClasificacionPanel.tsx` en Inicio,
  rutas `/api/clasificacion` (+ `/excel` para Contasis). Entrada = Excel del SIRE compras (RCE),
  parseado con `parseSireCompras`.
- `src/lib/cruceSire.ts` + `src/lib/xlsxIO.ts` (**exceljs**) — **Cruce SIRE vs sistema contable
  (Contasis)**: sube los Excel (SIRE RCE/RVIE + libros Contasis), empareja por serie‑número+RUC
  y compara base/IGV/total comprobante por comprobante; descarga el comparativo en Excel.
  Panel `CruceSirePanel.tsx` (suelto en **Inicio** vía `/api/cruce-sire`; también por cliente).
- `src/lib/analisisCompras.ts` — **Análisis de compras para RTP** (Libro Diario → clase 9 por
  función). Lee **todas las pestañas** (`parseLibroDiarioHojas`); agrupa por empresa (celda A1):
  varios meses de una empresa se combinan; un Excel con una pestaña por empresa (p. ej.
  "EGRESOS EMPRESAS OCT") da un análisis por empresa + el **consolidado del grupo**
  (`analizarGrupo`, `porEmpresa` = comparativo). Panel `AnalisisComprasPanel.tsx`
  (`/herramientas/analisis-compras`): con varias empresas abre en la 1.ª y descarga un ZIP con
  **un informe por empresa** (`/api/analisis-compras/por-empresa`, PDF o Excel); el consolidado
  queda como vista opcional.
- `src/lib/conciliacionSire.ts` — **Conciliación SIRE vs contabilidad por empresa** (sección al
  final del mismo módulo, `ConciliacionSireRtp.tsx`, `/api/analisis-compras/conciliacion` + `/excel`
  ZIP por empresa). **El SIRE no se sube**: se toma del módulo **Detalle SIRE** (caché
  `Cliente.sireDetalle["ventas-AAAAMM"]` / `["compras-AAAAMM"]` del cliente del estudio con el mismo
  RUC; periodo = el mes más frecuente del archivo contable o el elegido). Si falta, la UI enlaza a
  `/herramientas/detalle-sire?cliente=&tab=&periodo=` (o a `/clientes/nuevo?ruc=` si no está en
  Clientes) y se pulsa "Volver a conciliar". Subir el SIRE a mano queda como alternativa.
  **Ventas**: SIRE RVIE vs **Registro de Ventas** contable (Excel con una pestaña
  por empresa; empresa en A1, RUC en la fila 2; columnas Fecha · [T/D] · Documento "B002 0005839" ·
  R.U.C. · Afecto · IGV e IPM · Total). Llave = **tipo + serie + número** (las NC usan las mismas
  series que boletas/facturas); NC siempre en negativo en ambos lados. **Compras**: SIRE RCE vs
  Libro Diario (`diarioAComprobantes`: 42/46 = total, 4011 = IGV, resto = base). Cada SIRE se ubica
  en su empresa por RUC → razón social → asignación manual. 2.º paso: sueltos con mismo importe
  (+ tipo/fecha/cliente en ventas, + RUC proveedor en compras) = "Nº distinto". Motor: `cruceSire.ts`.
  **Subdiario aparte** (p. ej. misceláneos, campo `subdiario`, se sube después del análisis): NC u
  otros comprobantes que contabilidad registró fuera del Registro de Ventas y salen "Solo SIRE" se
  buscan por tipo + serie + número (`parseSubdiario`; `aplicarSubdiario`): si el monto cuadra pasan a
  OK (nota "subdiario"), si no, "Dif. montos". Estructura real (subdiario 09 MISCELÁNEOS, formato Libro
  Diario BAPU, una pestaña por empresa "VENT - SET - RTP", empresa en A1): cada asiento aplica la NC
  contra el comprobante original, ambos en la 12121001 — `CCB0010000010` (prefijo **CC** = nota de
  crédito) al Debe y `BVB0010005087`/`FTF…` al Haber. Solo se toman las CC/NC/ND; el otro documento
  del MISMO asiento (Sec. vuelve a 00001 en cada asiento) se muestra como "aplicada a". Avisa si el
  subdiario es de otro periodo que la conciliación. También acepta formato Registro.
  **Análisis de cierre** (`analisisCierre` en `cronogramaSunat.ts`): vencimiento de la DJ mensual
  por último dígito del RUC (cronograma oficial `OFICIAL`, si falta = referencial), días hábiles y
  calendario que quedan desde hoy (Lima) o días de atraso, estado (periodo abierto / en plazo /
  urgente ≤3 hábiles / vence hoy / vencido) + lo que falta regularizar por empresa; va en la UI y
  en el Excel resumen. **Solo aplica al periodo por declarar (mes anterior a hoy) y al mes en curso**
  (`cierreAplica`; el mes en curso se cuenta hasta su vencimiento del mes siguiente, `enCurso`);
  meses pasados → `cierreNoAplica` (solo una nota). **Informe PDF = solo resumen**
  (`conciliacionHtml.ts`, `/api/analisis-compras/conciliacion/pdf`: KPIs + cierre + resumen por
  empresa, A4 horizontal); el detalle comprobante por comprobante va en el Excel ZIP.
- **Empresas de SIMULACIÓN** (`src/lib/demo.ts`, `demoRutas.ts`, panel `DemoSupremo.tsx` en Supremo,
  `/api/supremo/demo`): 4 empresas ficticias (RUC 20 sana, RUC 20 con riesgos, RUC 10 con negocio, RUC 10
  sin negocio) con datos en todos los módulos (SUNAT, SIRE resumen/detalle/estado, buzón, DJ mensual
  vs SIRE, DJ anual, deudas y F36, ITF, diagnóstico, Visor). Id `demo-…`, `Cliente.demo = true`, RUC con
  dígito verificador INVÁLIDO (no existen). Las rutas que consultan SUNAT responden con datos simulados
  (`esClienteDemo` / `demoNoDisponible` / `esRucDemo` en RTT y honorarios); `getSolPass` da la clave por
  cargada; la tarea nocturna las excluye. Ruta nueva que consulte SUNAT → agregar el control demo.
  **Modo grabación** (`Usuario.modoGrabacionHasta`, 12 h, `setModoGrabacion`, acción "grabacion" en
  `/api/supremo/demo`): `listClientes(ownerId)` devuelve solo las empresas demo (Clientes, Dashboard,
  buscador, notificaciones, selectores) y `getVisorMatriz` solo sus cuadros. La tarea nocturna usa
  `listClientes(id, { todos: true })` para no perder alertas reales.
- `src/lib/diagnostico.ts` — motor de hallazgos/score (incluye consistencia declaración vs SIRE).
- El informe termina con **"Observaciones para la toma de decisiones"** (consolida SUNAT, deudas,
  buzón, declaración vs SIRE y DJ anual) + sección de **Deudas tributarias**.
- `src/components/SunatPanel.tsx` — panel unificado (credenciales 1 vez): SIRE + buzón, "Extraer todo".
- `src/components/DeclaracionesPanel.tsx` — subir PDF de declaración → confirmar montos → comparar vs SIRE.
- `src/app/clientes/[id]/informe/page.tsx` — informe imprimible (dashboard, contingencias, buzón, SIRE, declaración vs SIRE).
- API: `src/app/api/clientes/[id]/{sire,buzon,sunat,declaraciones,diagnostico}/route.ts`.

### Declaraciones mensuales vs SIRE (`declaracion.ts`)
- **unpdf** (pdf.js serverless) extrae el texto del PDF — solo sirve si el PDF trae capa de
  texto (constancia/Formulario 621). Si es escaneo/imagen, no hay texto → ingreso manual.
- Parser detecta periodo, RUC, formulario y **casillas** (código 3 dígitos → monto).
- `MAPA_CASILLAS` (en el archivo) mapea casillas → ventasBase/ventasIgv/comprasBase/comprasIgv.
  ⚠️ **AJUSTABLE**: calibrar con una constancia real usando **Modo diagnóstico** (devuelve
  texto crudo + casillas detectadas), igual que se hizo con SIRE/buzón.
- UI deja los 4 montos **editables** antes de guardar (el contador confirma/corrige), y
  permite **ingreso manual** sin PDF. `compararDeclaracionSire` marca alerta si |declarado−SIRE| > S/1.

## SUNAT — integraciones (lo más valioso, descubierto a pulso)

### RUC (decolecta)
- Host `api.decolecta.com/v1/sunat/ruc/full?numero=RUC`, `Authorization: Bearer DECOLECTA_TOKEN`.

### SIRE (api-sire.sunat.gob.pe, OAuth2)
- **Credencial**: la genera el contribuyente en SUNAT "API SUNAT / Gestión Credenciales".
  ⚠️ **Alcance debe ser "Desktop"** (no "Web"); con Web el token sale 200 pero el recurso da 401.
  Servicio a habilitar: "MIGE RCE y RVIE - SIRE" (y "Control de mensajes" para el buzón).
- **Token**: POST `https://api-seguridad.sunat.gob.pe/v1/clientessol/{clientId}/oauth2/token/`
  body `grant_type=password&scope=https://api-sire.sunat.gob.pe&client_id&client_secret&username={RUC}{usuarioSOL}&password={claveSOL}`.
- **Base**: `https://api-sire.sunat.gob.pe/v1/contribuyente/migeigv/libros`.
- **codLibro**: **VENTAS (RVIE) = 140000**, **COMPRAS (RCE) = 080000** (confirmado empíricamente; ¡no es lo intuitivo!).
- **Resumen (totales por periodo)** — devuelve el contenido DIRECTO (sin ticket):
  `GET .../rvierce/resumen/web/resumencomprobantes/{periodo}/{codTipoResumen=1}/{codTipoArchivo=0}/exporta?codLibro={codLibro}`
  - `codTipoResumen` debe ser **1 dígito**. **1 = registro/preliminar con datos**.
  - Respuesta = txt con header `Tipo de Documento|Total Documentos|BI Gravado DG|IGV / IPM DG|...|Total CP` (compras)
    o columnas de ventas (`BI Gravada`, `IGV / IPM`, `Valor Facturado Exportación`, `Mto Exonerado`, etc.).
  - Parser: suma por "Total Documentos" (nº cpe), salta fila "Total". Headline = `Total CP`.
  - `1070`/"No se ha encontrado información" = sin movimiento → 0.
  - Ventas suelen estar en USD; el resumen suma "Total CP" tal cual (no convertir).
- **Estado presentado/no presentado por periodo**:
  `GET .../rvierce/padron/web/omisos/{codLibro}/periodos` → **array por ejercicio**:
  `[{ numEjercicio, desEstado, lisPeriodos:[{ perTributario:"YYYYMM", codEstado, desEstado:"Presentado"/"No Presentado" }] }]`.
  Hay que **aplanar `lisPeriodos`** y buscar el `perTributario`; `codEstado 02`=Presentado, `03/04`=No Presentado.
- Endpoints de propuesta/ticket (legacy, ya no usados por defecto): `/rvie/propuesta/web/propuesta/{periodo}/exportapropuesta`,
  estado `consultaestadotickets?perIni=&perFin=&numTicket=`, descarga `archivoreporte`.

### Buzón electrónico (NO tiene API pública → Playwright)
- `playwright-core` + `@sparticuz/chromium` (corre en Render Node sin Docker).
- Flujo en `consultarBuzon`: login SOL (`e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm`,
  campos `#txtRuc/#txtUsuario/#txtContrasena`, botón `#btnAceptar`) →
  cerrar campaña "Valida tus datos" (iframe `itadminforuc-modifdatos`, botones **Finalizar** +
  **Continuar sin confirmar**) → clic `<a id="aOpcionBuzon">` → esperar iframe `ol-ti-itvisornoti` →
  `fetch` interno en ese frame:
  `https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/listNotiMenPag?tipoMsj=2&codCarpeta=00&codEtiqueta=&page=1&des_asunto=&codMensaje=&tipoOrden=NADA`
  (pagina con `page=N`; rows: `desAsunto`, `fecPublica`, `codMensaje`, `codEtiqueta`).
- Filtra al **mes en curso** (corte = max(inicio de mes, hoy-15d)).
- Clasifica por asunto: **PELIGROSO** (Fiscalización, No Contenciosa) y **URGENTE** (Cobranza, Valores).
  Pendiente: mapear `codEtiqueta` → etiqueta para clasificación exacta (hoy es por palabras del asunto).

## Planes, cupos y pagos
- Planes (`modulos.ts`, textos en `planes.ts`): **Básico** gratis = Reporte analítico + Consultas
  tributarias · **Regular** S/ 9.99 = + Detalle SIRE + Visor · **Premium** S/ 19.99 = + RTT +
  Descarga masiva (500 comprobantes/mes) + seguimiento 24 h del buzón (Telegram/correo, NUEVO) ·
  **Empresas** (`equipo`) a cotizar. Precios de lanzamiento −50 % para las primeras
  `LANZAMIENTO_CUPOS` (100) personas; quien lo obtuvo lo conserva al renovar.
- Cupos (`cupos.ts`): generaciones por **RUC + paso** al mes (Lima): Básico 3, Regular 5, Premium y
  Empresas sin límite (env `CUPO_*`). Solo consume tras éxito (`verificarCupo` → `consumirCupo`).
  SIRE de varios periodos manda un `lote` = 1 generación. Tope de comprobantes (`TOPE_COMPROBANTES_*`).
  Empresas: límites pactados por cuenta (`Usuario.limitesCotizados`, panel del supremo).
- Pagos (`pagos.ts`): `PASARELA` = **izipay** (la del cliente; formulario incrustado REST V4 de
  micuentaweb) · también soporta culqi | mercadopago. Confirmación SIEMPRE del lado
  servidor (cargo Culqi con sk, consulta a la API de MP, firma HMAC de Izipay) → `acreditarPago`
  (idempotente, +30 días; renovar suma; cambiar de plan convierte los días restantes). Webhooks en
  `/api/webhooks/pagos/*` (públicos por el middleware). Sin pasarela configurada, los botones
  vuelven a WhatsApp.

## Seguridad (reglas del sistema)
- **Planes en el servidor**: toda ruta de un módulo de pago empieza con `bloqueoModulo("clave")`
  (`src/lib/acceso.ts`); las páginas usan `exigirModuloPagina`. Al crear una ruta nueva de un
  módulo, agrega la guarda. Solo supremo: `bloqueoSupremo()`.
- **Store**: toda función de `db.ts` que escribe corre dentro de `conBloqueoStore` (candado
  reentrante): no hay pérdidas por escrituras simultáneas. Funciones nuevas que escriban deben
  envolverse igual.
- **Modo diagnóstico**: solo el supremo (`limpiarDiagnostico(body)` tras leer el cuerpo).
- **Límites**: `src/lib/limite.ts` (login por IP y correo, registro, códigos, pagos, Asociación,
  consulta RUC, webhook RTT).
- **Sesiones**: el token lleva `sesionVersion`; restablecer la contraseña cierra las demás
  sesiones; una cuenta rechazada pierde la sesión. Contraseña mínima 8. El cambio de contraseña
  es SOLO desde el login ("Olvidé mi contraseña", código al correo); `/cuenta` redirige y
  `/api/auth/cambiar` responde 410.
- **Secretos**: el client_secret SIRE nunca va al navegador (`ocultarCliente`/`resolverSecreto`
  en `src/lib/secretos.ts`). **Cifrado en disco** (AES-256-GCM, `src/lib/cifrado.ts`): `writeStore`
  cifra `credSire.clientSecret` y `config.{browserWsUrl,rttSecret,capsolverKey,proxyPass}`
  (`serializarStore`) y `readStore` los descifra (`descifrarSecretos`): store.json y backups
  quedan con `v1:…`; en memoria se ven en claro. Llave = VIGILANCIA_KEY (o AUTH_SECRET):
  **no cambiarla** o habrá que volver a ingresar esas credenciales. Sin contraseña supremo por defecto en el código. El panel Supremo y
  el log avisan si falta AUTH_SECRET, VIGILANCIA_KEY, SUPREMO_PASSWORD o APP_URL.
- **Políticas y registro de accesos** (evidencia ante reclamos): el registro exige marcar la
  Política de seguridad y la Declaración de responsabilidad (texto en `src/lib/legal.ts`,
  página pública `/legal`). Constancia por usuario en `Usuario.aceptaciones` (versión, fecha, IP,
  navegador, huella SHA-256 del texto). El token de sesión lleva `t` = versión aceptada; el
  middleware manda a `/aceptar` (API → 403) si no es `TERMINOS_VERSION` (supremo y "solo RTP"
  exentos). Cambiar el texto de forma sustancial → subir `TERMINOS_VERSION` (todos vuelven a
  aceptar). **Registro de accesos**: `getCurrentUser` llama a `anotarPeticion` (una vez por
  petición, con las cabeceras x-pathname/x-metodo/x-query/x-req-id que pone el middleware):
  cada página, cada POST/PUT/DELETE y las lecturas sensibles van a `DATA_DIR/accesos/AAAA-MM.jsonl`
  (`src/lib/registroAccesos.ts`; líneas firmadas con HMAC, 5 años, van en el backup ZIP y la
  restauración no las pisa); login/registro también. ⚠️ El middleware debe quedar en runtime
  **edge**: con `runtime: "nodejs"` (Next 15.5) las subidas de archivos fallan a veces con
  "Response body object should not be disturbed or locked".
  El supremo descarga CSV (accesos por mes/RUC/correo y constancias) en `/api/supremo/accesos`.
- **Una sesión por navegador**: todas las pestañas comparten la cookie. `SesionGuard` (en AppShell,
  con el `uid` de la pantalla) consulta `/api/auth/sesion` al volver a la pestaña y escucha
  `localStorage["radar:sesion"]` (lo escriben login/logout con `anunciarSesion`): si la cuenta
  cambió en otra pestaña, bloquea la pantalla vieja y obliga a recargar. El login navega con
  `window.location.assign` (sin páginas de la cuenta anterior en memoria).
- **Accesos SOL por empresa** (`AccesosSol`): al cambiar de empresa se reinicia todo (usuario, clave,
  API) y además lleva `key={cliente.id}` en las herramientas con selector de empresa; antes "Cargar
  accesos" guardaba los datos de la empresa anterior en la nueva.
- **Datos por estudio**: memorias de cuentas (`memoriasEstudio`), RTT con dueño, bitácora filtrada.
- **Supremo**: con `SUPREMO_2FA=1` el login del supremo pide además un código de 6 dígitos
  (`codigos.ts`, tipo "acceso") que va a `SUPREMO_2FA_CORREO` (correo real; el del supremo es
  genérico) y/o al Telegram vinculado de la cuenta supremo. Sin ningún canal, no bloquea. El login solo redirige a rutas internas (`?next=/…`).
- **Entradas públicas**: avisos de pago con cuerpo ≤ 64 KB y límite por IP; ZIP subidos se
  descomprimen con `descomprimirSeguro` (topes por archivo, total y cantidad); los correos
  escapan nombres y datos del usuario.
- **PDF**: usar `./pdfTexto` (adaptador de unpdf 1.x que conserva el formato de texto anterior).
- **Next 15**: `params`, `searchParams`, `cookies()` y `headers()` son asíncronos (usar `await`).
- **Contenedor** (Lightsail, `deploy/`): Dockerfile en dos etapas; la app corre como usuario
  `node` (uid 1000). `deploy/entrypoint.sh` entrega `/var/data` a ese usuario al arrancar y suelta
  root con `setpriv`. `xlsx` (sin parche en npm) solo se usa en utilitarios del supremo.

## Hecho
RUC + autollenado · SIRE compras/ventas reales + acumulado + presentado/no presentado ·
buzón (más peligroso aparte) · declaraciones PDF vs SIRE · diagnóstico · dashboard · informe de gerencia
(contingencias, buzón, SIRE, gráficos juntos en una hoja al imprimir) · "Extraer todo"
(SIRE todos los meses del año + buzón mes actual).

## Pendiente / ideas
- Buzón: clasificar por `codEtiqueta` exacto (capturar endpoint de etiquetas).
- Persistencia real (disco Render o BD) para no perder datos entre deploys.
- Autenticación de usuarios (multiusuario) si se requiere.
- Caso límite: SIRE "presentado vacío" — el estado real ya viene de omisos/periodos.

## Convenciones
- `npm run build` debe pasar antes de push. Verificar con: `grep -c "Failed to compile"`.
- Probar cambios SUNAT con **Modo diagnóstico** (cada módulo tiene un probe que muestra
  la respuesta cruda de SUNAT — así calibramos endpoints sin adivinar).
