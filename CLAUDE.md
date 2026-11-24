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
- **RUC siempre limpio**: `readStore` pasa cada `Cliente.ruc` (y las llaves de `rucsRegistrados`) por `rucLimpio`
  (quita espacios y caracteres invisibles cuando quedan 11 dígitos; se guarda limpio en la siguiente escritura). El alta
  (`POST /api/clientes`) quita espacios antes de validar y `obtenerToken` arma el usuario con el RUC solo en dígitos.
- **RUC único**: no se permite crear dos clientes con el mismo RUC (chequeo en
  `POST /api/clientes` con `getClienteByRuc`, responde 409). Unicidad **global** entre estudios
  (`duenoDeRuc` / `rucsRegistrados`): un RUC tomado por otro estudio no se puede registrar,
  **salvo el supremo y la cuenta "Utilitarios RTP"** (`exentoUnicidadRuc`; sus módulos son propios),
  que pueden registrarlo igual sin adueñarse (no entra al registro global,
  sus copias no bloquean a nadie y borrarlas no libera el RUC del dueño; queda en la bitácora). Un registro
  global que apunte al supremo o a Utilitarios RTP (pudo quedar de antes de la exención) no vale: `duenoDeRuc`
  lo borra y el RUC queda libre para la cuenta que lo gestiona (p. ej. Contabilidad). Regla del dueño: la cuenta
  que gestiona es la DUEÑA; Utilitarios RTP solo tiene copias de apoyo contable. La razón social verificada por
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
  **Compras con REGISTRO DE COMPRAS** (2.ª sección del módulo: `<ConciliacionSireRtp libro="compras" />`, envía
  `libro=compras`): `parseRegistroComprasHojas` (una pestaña por empresa; empresa en A1, RUC en la fila 2, título
  "REGISTRO DE COMPRAS NOVIEMBRE DEL 2026" → `periodoTitulo`; columnas Fecha · Fecha Venc. · [tipo, sin título] ·
  Comprob. "F401 6643" · RUC · Proveedor · Base Imponible ×3 · Adquisiciones no Gravadas · I.G.V. ×3 · Otros · Total;
  la fila de totales no trae Comprob.). Llave = serie + número + RUC del proveedor; base = suma de las 3 bases,
  IGV = suma de los 3. El Registro de Compras manda sobre el Libro Diario (que sigue valiendo si no hay registro).
  **TODAS las pestañas salen como empresa, también las vacías** (pedido del dueño; igual en ventas con
  `parseRegistroVentasHojas(buf, true)`): lo que no está en contabilidad puede estar en el SIRE. Casos: contabilidad
  vacía + SIRE con datos = todo "Solo SIRE"; SIRE descargado SIN movimiento (caché con 0 filas, es válido:
  `sireDesdeDetalle(..., libro)`) = "Sin movimiento" o todo "Solo contable"; sin caché o sin cliente = fila gris
  "Falta descargar el SIRE" / "No está en Clientes" (`faltantes` con comprobantes y total contables; van también al
  Excel resumen y al PDF). Periodo de una pestaña vacía = título de la hoja o el más frecuente de todo el archivo.
  **Compras = solo el mes** (pedido del dueño; `separarMesesAnteriores`, se aplica tras `conciliar` solo en compras):
  las filas "Solo contable" con fecha de emisión de un mes ANTERIOR al periodo (p. ej. recibos de luz/agua de
  octubre registrados en noviembre) salen de la conciliación a `ConciliacionEmpresa.anteriores` (cuadro aparte en
  pantalla, hoja "Meses anteriores" del Excel de la empresa, columnas en el resumen y en el PDF) y se restan de los
  totales contables y de "Solo contable"; así el bloque del mes sirve para verificar que todo lo del mes está
  provisionado. Lo que SÍ está en el SIRE del periodo se queda aunque su fecha sea anterior (ese cruce es válido).
  Caso real: BA nov-2026 = 13 comprobantes del mes + 4 recibos (tipo 14) de octubre por S/ 1,118.68.
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
  `/api/demo`): 4 empresas ficticias (RUC 20 sana, RUC 20 con riesgos, RUC 10 con negocio, RUC 10
  sin negocio) con datos en todos los módulos (SUNAT, SIRE resumen/detalle/estado, buzón, DJ mensual
  vs SIRE, DJ anual, deudas y F36, ITF, diagnóstico, Visor). Id `demo-…`, `Cliente.demo = true`, RUC con
  dígito verificador INVÁLIDO (no existen). Las rutas que consultan SUNAT responden con datos simulados
  (`esClienteDemo` / `demoNoDisponible` / `esRucDemo` en RTT y honorarios); `getSolPass` da la clave por
  cargada; la tarea nocturna las excluye. Ruta nueva que consulte SUNAT → agregar el control demo.
  **Modo grabación** (`Usuario.modoGrabacionHasta`, 12 h, `setModoGrabacion`, acción "grabacion" en
  `/api/demo`): `listClientes(ownerId)` devuelve solo las empresas demo (Clientes, Dashboard,
  buscador, notificaciones, selectores) y `getVisorMatriz` solo sus cuadros. La tarea nocturna usa
  `listClientes(id, { todos: true })` para no perder alertas reales.
  **Acceso para otras cuentas**: el supremo lo habilita por correo (Supremo → Modo simulación → "Dar
  acceso", `/api/supremo/demo-acceso`, `setPermisoDemo`): `Usuario.permisoDemo = true` + plan
  **equipo** sin vencimiento (todos los módulos, sin utilitarios). Esa cuenta ve "Modo simulación" en su
  menú (`/simulacion`) y usa `/api/demo` (crear/regenerar/borrar SUS empresas demo, ids
  `demo-<clave>-<sufijo>`; modo grabación). Las del supremo siguen como `demo-<clave>`.
- **Proyección tributaria** (UTILITARIO, clave `proyeccion`, `/herramientas/proyeccion`; solo supremo o
  cuentas con el utilitario habilitado; `ProyeccionPanel.tsx`). **No consulta SUNAT**: se elige empresa +
  periodo y arma el informe con lo YA generado: (1) SIRE del mes = resumen de la ficha (Reporte analítico,
  `Cliente.sire`) y (2) Detalle SIRE ventas/compras (`Cliente.sireDetalle`). El paso 1 de la pantalla muestra
  qué falta y enlaza a `/clientes/[id]` y a `/herramientas/detalle-sire?cliente=&tab=&periodo=`; al volver a
  la pestaña se vuelve a comprobar. `src/lib/proyeccion.ts` (`armarProyeccion`): análisis del detalle (por
  tipo de comprobante, top 10 clientes/proveedores, NC, moneda extranjera a soles), **cuadre resumen vs
  detalle** y base del cálculo ("resumen" o "detalle"; si no cuadran o falta el resumen, usa el detalle).
  Cálculo en `src/lib/planeamiento.ts` (puro, tipo PDT 621): IGV = débito − crédito − **saldo a favor del
  mes anterior (casilla 145, MANUAL: "No tiene / Sí tiene" + monto)** − percepciones − retenciones → IGV a
  pagar o saldo a favor siguiente; renta = pago a cuenta según régimen (`regimenSugerido` por
  `sunat.tributos`, editable): General coeficiente o 1.5 %, MYPE 1 % hasta 300 UIT del año (`UIT` ajustable)
  y luego coeficiente/1.5 %, RER 1.5 %, Nuevo RUS cuota fija, sin negocio = nada. + vencimiento
  (`analisisCierre`) y recomendaciones. Datos manuales por periodo en `Cliente.planeamiento[AAAAMM]`
  (`setPlaneamiento`); un mes sin datos sugiere el saldo que dejó el anterior. API `/api/proyeccion`
  (GET datos, POST guardar) y `/api/proyeccion/pdf` (informe A4, `proyeccionHtml.ts`), con
  `bloqueoModulo("proyeccion")`. (Antes fue la sección 7 de la ficha; se movió al utilitario.)
- **Detalle SIRE — NO INCLUIDOS (rechazados) en el mismo Excel**: tras extraer el detalle, el panel hace una
  2.ª consulta (`soloNoIncluidos: true` en `/api/clientes/[id]/sire-detalle` → `consultarNoIncluidosSire` en
  `sire.ts`): ventas = "Propuesta / No incluidos" (comprobantes RECHAZADOS y otros que SUNAT dejó fuera);
  compras = "Excluidos". Se guardan en `Cliente.sireDetalle[clave].noIncluidos` (aparte: NO cuentan en
  conciliaciones ni en la proyección) y el Excel (`/api/sire-detalle/excel`) los pone en otra hoja
  ("Ventas - No incluidos" / "Compras - Excluidos"). Si SUNAT no entrega la lista, el detalle queda igual y
  sale una nota. ⚠️ **Rutas POR CALIBRAR con una empresa real** (Modo diagnóstico las muestra bajo
  "---- no incluidos ----"): candidatas `/rvie/propuesta/web/noincluidos/{periodo}/exportanoincluidos…` y
  `/rce/propuesta/web/excluidos/{periodo}/…`; se fijan con `SIRE_NOINCLUIDOS_VENTAS_PATH` /
  `SIRE_NOINCLUIDOS_COMPRAS_PATH`. `exportarPropuesta(..., { seguirEn4xx: true })` prueba el siguiente
  candidato ante 4xx solo en esta consulta (la propuesta normal no cambió).
  Una lista VACÍA solo se da por cierta si SUNAT respondió 200 (archivo/ticket) o con su código 1070; un
  "no encontrado" genérico = "no confirmado" (nota ámbar, no se guarda). Lo guardado lleva
  `v = VERSION_NO_INCLUIDOS` (2); lo de una versión anterior se vuelve a consultar. Caso real pendiente:
  NC F007-130 (cliente 20429350264) figura como rechazada en SUNAT y la v1 dijo "ninguna".
  **Los no incluidos/excluidos son OPCIONALES y en segundo plano** (pedido del dueño: la extracción tardaba ~5 min
  esperando esa 2.ª consulta, incluso con el detalle ya guardado): ya no se piden solos tras extraer; hay un botón
  "Consultar excluidos / no incluidos" que no bloquea el botón Extraer ni el Excel (`niBusy`, `periodoVisto` evita
  pisar otro mes). Si ya están guardados (v2) salen directo.
- **Detalle SIRE — rango de meses → ZIP** (`DetalleSirePanel.tsx`, pestaña "Rango de meses (ZIP)"): Desde/Hasta
  (máx. 24 meses); extrae mes por mes con la misma ruta (`pedirPeriodo`: lo guardado sale al instante, lo demás se
  pide a SUNAT esperando el ticket) y al final llama a `POST /api/sire-detalle/zip` `{ clienteId, tipo, periodos }`,
  que NO consulta SUNAT: arma un Excel por mes desde `Cliente.sireDetalle` (`src/lib/sireDetalleExcel.ts`, el mismo
  de `/api/sire-detalle/excel`) + `00-RESUMEN.xlsx` (comprobantes, Total CP, excluidos, situación). Si un mes
  falla, se vuelve a pulsar y solo se reintenta ese.
- **Detalle SIRE — aviso de demora de SUNAT** (`DetalleSirePanel.tsx`): si la conexión se corta mientras
  SUNAT genera la propuesta, o SUNAT sigue "en proceso" tras el 2.º intento, o el servidor recibe de SUNAT
  `fetch failed`/5xx/429, sale una VENTANA "SUNAT está demorando — Por demoras de carga de SUNAT, las
  descargas del SIRE se están demorando". Los cortes de conexión se reintentan solos (hasta 3 seguidos; SUNAT
  retoma el mismo ticket). Un rechazo de credenciales NO abre la ventana: muestra el error de SUNAT.
- **Conciliación bancaria de 3 vías** (utilitario `conciliacion`, `/herramientas/conciliacion`; reemplazó al
  módulo anterior de extracto PDF + libro banco): `src/lib/conciliacionCaja.ts`, `ConciliacionPanel.tsx`,
  `/api/conciliacion`. Tres cargas en Excel (.xlsx, exceljs): **Contabilidad** (Registro de Ventas StarSoft:
  Fecha · [T/D] · Documento · R.U.C. · Nombre · Total · Referencia), **Caja virtual** (tramas de cobranza: por
  voucher SUBDIARIO+COMPROBANTE una línea de dinero en cuenta 10… —efectivo del día por sede, o una
  transferencia con su N° de operación— y debajo los comprobantes que cancela en cuenta 12…; NC = Debe en 12…)
  y **Bancos** (varios archivos u hojas, una por cuenta; columnas Cargo/Abono o Importe con signo). Cada hoja se
  reconoce por sus encabezados (`tipoDeHoja`), así que un solo Excel con todas las pestañas también sirve.
  Vínculo: comprobante ─(serie+número, `claveDoc`)→ cobro ─→ banco. Cobro→banco (`conciliarTresVias`):
  (A) N° de operación · (A2/A3) nombre del cliente en el concepto del banco + monto, ±3 días (`puntosNombre`,
  tolera la última palabra cortada) · (B) efectivo = depósito de monto exacto en 0–7 días · (C) transferencia misma fecha y
  monto, desempate por nombre del cliente en el concepto; varias iguales = "cuadran en conjunto" · (D) ±3 días ·
  (D2) monto único con abono posterior · (E) efectivo en dos depósitos · (F) depósito tardío. Lo no vinculado =
  **"No conciliado"** (pedido del dueño: no usar "por cobrar" ni reglas de plazo) con motivo; pistas: depósito
  con diferencia (±3 % / S/ 50), "fin de mes" (cobro de los últimos 6 días: el depósito puede estar el mes
  siguiente) e "inicio de mes" (abono de los primeros 6 días: ventas del mes anterior). `porFecha`: por día,
  ventas (contabilidad) vs caja (efectivo + transferencias) y cuánto de esa caja llegó al banco y cuándo.
  **Salida simple en UNA hoja** (pedido del dueño): `unificada` (`FilaUnica`) = la misma fila en tres bloques,
  Contabilidad · Caja virtual · Bancos, con el **punto en común** resaltado en dorado: ★ el comprobante
  (contabilidad ↔ caja) y ◆ el total del cobro + fecha o N° de operación (caja ↔ banco), más las columnas
  "Punto en común" que dicen con qué se concilió. Al final van los abonos del banco sin cobro y los cargos.
  Si una transferencia se concilió solo por fecha y monto y el nombre del banco NO es el del cliente (caso real:
  boleta de CAMPOS RAMIREZ FLAVIO ↔ "ABONO INMEDIATO 002 MARIA D"), la fila queda Conciliada pero con la
  observación "El nombre que trae el banco no es el del cliente… Verificar" (≈ 40 % de las transferencias).
  **Contabilidad también desde el Libro Diario** (`parseDiario`; hoja reconocida por "Sec. | Cuenta | … | Debe |
  Haber"): cada venta es un asiento del subdiario 03 con el comprobante en la 12… ("BVB0010007472": prefijo BV/FT/
  CC + serie + número; Debe = total, NC = Haber), IGV en 40…, ingreso en 70…; la fecha sale de Fec.Doc. (la de la
  cabecera llega con día/mes cruzados). Solo cuentan los asientos con 12…/13… y además 70…/40… (otros subdiarios
  se ignoran con aviso). El Diario NO trae el nombre del cliente: solo, las transferencias iguales del mismo día
  cuadran "en conjunto"; con el Registro además (la casilla 1 acepta los dos) manda el Registro y el Diario hace de
  control cruzado (avisos de faltantes o importes distintos). Caso real: diario oct-2026 = Registro, 1,640 de 1,640.
  **Extracto conciliado** (formato de las conciliaciones manuales del cliente, ej. abril): una hoja por cuenta
  ("Banco <cuenta>") y pestaña en pantalla, con el extracto en el orden del banco + columna CONCILIACIÓN
  (`FilaBanco.conciliacion`) = la glosa del cobro de la caja ("CANCELA BV B0010007472 - TRANS.BBVA RTV ICA",
  "DEP. X VTAS 01/10/2026 EFECTIVO RTV ICA"); cargos: solo sugerencia evidente (`sugerirCargo`: ITF, comisión,
  HABER TLC = haberes), el resto lo completa contabilidad.
  Excel: Conciliación (hoja única) · Banco <cuenta>… · Resumen · Por fecha. Pantalla: pestañas Conciliación (con
  "Solo lo no conciliado" y buscador), Extracto conciliado y Por fecha. Caso real de calibración:
  RTV San Cristóbal oct-2026 (1,640 comprobantes → 1,493 conciliados). Limitación: el N° de operación de la
  caja casi nunca está en el extracto del BBVA y el concepto viene cortado a 28 caracteres.
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
- **Rechazo de accesos**: SUNAT devuelve HTTP 400 `access_denied · "Error en la autenticacion del usuario."` falle lo
  que falle (usuario, clave o API; comprobado con un client_id inventado), así que `obtenerToken` lo traduce a un
  mensaje que lista los tres datos y cómo ubicar cuál (ITF/buzón con la misma clave: si entran, falla el API).
  Antes de enviar limpia espacios de los cuatro datos y pasa el Usuario SOL a mayúsculas. Ojo: el SIRE usa
  `credSire.solUser`; la vigilancia del buzón guarda SU propio usuario y clave (pueden no ser los mismos).
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
- **Modo diagnóstico**: solo el supremo (`limpiarDiagnostico(body)` tras leer el cuerpo; en rutas con
  formulario — declaraciones mensual y anual — `esSupremo` sobre el campo `diagnostico`). En la interfaz la
  casilla solo se dibuja con `usePuedeDiag()` (SupremoContext): todo panel nuevo debe usarlo.
  Las librerías SUNAT arman la traza (`diag`: pasos, peticiones, respuestas crudas) SIEMPRE: cada ruta llama
  a `ocultarDiag(r)` justo después de la consulta para quitarla (y limpiar el mensaje) si no es el supremo.
  Ruta nueva que devuelva el resultado de una librería SUNAT → llamar a `ocultarDiag`. Los mensajes de error
  de las librerías ya no mencionan el Modo diagnóstico.
- **Opciones del periodo de prueba, solo supremo**: SIRE de ejemplo/simulado (`real !== true` → 400 para
  el resto; botón "Ver ejemplo"), "Probar envío" del buzón, `/api/rtt/probar-webhook`, cargar una DJ
  (mensual o anual) de OTRO RUC (para el resto se rechaza si el PDF trae un RUC y el de la empresa no
  aparece; las empresas demo quedan exentas). La consulta RUC **nunca** da datos simulados por omisión en
  producción (solo con `SUNAT_PROVIDER=mock` / `SUNAT_FORCE_MOCK`). **Pagos en modo prueba** (claves de
  test): solo las cuentas de `PAGOS_PRUEBA_CORREOS` ven la pasarela y se les acredita
  (`puedePagarEnLinea`); para el resto cuenta como no configurada.
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
- **Registro**: activar la cuenta exige el código del correo **y** la contraseña del registro
  (`/api/auth/verificar`); volver a registrarse con un correo sin verificar reemplaza la contraseña y el
  nombre por los del nuevo intento (nadie deja "pre-registrado" el correo de otra persona).
- **Redirecciones** tras login/aceptar: `rutaInterna()` (`src/lib/rutaInterna.ts`), solo rutas internas y
  sin caracteres de control.
- **PDF desde HTML de la app** (`page.setContent`): abrir el contexto con `contextoPdf(browser)`
  (`navegador.ts`: sin JavaScript y sin red) y escapar/forzar a número todo dato que venga del navegador.
- **RTT**: el RUC debe ser de una empresa del estudio y `rucLogin === ruc` (el reporte se cruza por RUC).
- **Cupos**: una tanda (`lote`) ya contada vale 60 minutos (`loteVigente`); luego cuenta de nuevo.
- **Salida al navegador**: `publicUser` quita hashes de contraseña/códigos/recuperación y el código de
  Telegram; `ocultarCliente` quita también `vigilancia.claveEnc` (solo de la respuesta; en el store sigue).
  El `codMensaje` del buzón (ruta de adjuntos) rechaza solo `/`, `\`, `..` y caracteres de control, porque
  va en el nombre del archivo guardado.
- **Fugas de datos (2.ª revisión)**:
  · Claves SOL del navegador (`sessionStorage`, `solSession.ts`): `borrarClavesSol()` al cerrar sesión, al
    iniciar otra y cuando `SesionGuard` detecta que la sesión cambió (equipos compartidos).
  · Sesión SUNAT en memoria (`sunatSesion.ts`): la llave del caché incluye una huella de la Clave SOL; solo
    quien presenta la misma clave reutiliza la sesión abierta (antes bastaba RUC + usuario).
  · Entrada sin HTTPS (p. ej. `http://IP_PUBLICA`): el middleware redirige a `APP_URL` (308), salvo llamadas
    internas (127.0.0.1) y rutas de máquina con secreto propio (webhooks, tarea nocturna, captura del Visor).
  · Respaldos (`deploy/respaldo-s3.sh`): `umask 077`, carpeta 700 y subida a S3 con `--sse AES256`;
    `/var/data` queda 700 (`entrypoint.sh`).
  · `revisarConfiguracion` (`seguridad.ts`) marca CRÍTICO si AUTH_SECRET / VIGILANCIA_KEY siguen con el texto
    de ejemplo del `.env`.
- ⚠️ **NO TOCAR sin pedido expreso del dueño: vigilancia 24 h del buzón y alertas al celular/correo**
  (servicio plus): `nocturna.ts`, `alertas.ts`, `email.ts`, `/api/alertas`, `/api/clientes/[id]/vigilancia`,
  `/api/consultas/buzon/seguimiento`, `/api/tareas/nocturna`, `VigilanciaBuzonPanel`, `AlertasConfig`. Los
  ajustes de seguridad o de otros módulos no deben cambiar su comportamiento.
  **Cambios pedidos por el dueño (nov-2026)**: (1) Buzón vigilado = UN SOLO aviso por empresa y noche
  (`src/lib/avisosBuzon.ts`, puro: `elegirAvisosBuzon` + `textoAvisoBuzon`): la notificación más reciente con su PDF
  y, si llegaron más, la lista de las otras. Primera lectura tras activar (`VigilanciaBuzon.base` aún sin marcar y sin
  vistos) = solo la ÚLTIMA; las anteriores quedan vistas sin enviarse (antes salían las 12 del buzón por empresa:
  más de 300 mensajes en una noche). Lo de más de `BUZON_ALERTA_MAX_DIAS` (10) días nunca se avisa. (2) Vencimiento
  de la declaración mensual = opcional y POR EMPRESA: solo las marcadas (`Cliente.avisoVencimiento`, ninguna por
  defecto; `setAvisoVencimiento`), lista con casillas en Alertas (`/api/alertas`: `vencimientoEmpresa` /
  `vencimientoTodas`, solo admin del estudio); el interruptor general `alertas.cronograma` sigue como pausa global.
- **PDF**: usar `./pdfTexto` (adaptador de unpdf 1.x que conserva el formato de texto anterior).
- **Next 15**: `params`, `searchParams`, `cookies()` y `headers()` son asíncronos (usar `await`).
- **Contenedor** (Lightsail, `deploy/`): Dockerfile en dos etapas; la app corre como usuario
  `node` (uid 1000). `deploy/entrypoint.sh` entrega `/var/data` a ese usuario al arrancar y suelta
  root con `setpriv`. `xlsx` 0.18.5 (sin parche en npm) lo usan los utilitarios de conciliación bancaria, StarSoft, ventas-caja y
  comparativo de ingresos (supremo, cuenta RTP y cuentas con el utilitario): pendiente pasarlos a exceljs (`xlsxIO`).

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
