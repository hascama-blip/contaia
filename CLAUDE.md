# ASENCOIA — Plataforma de diagnóstico tributario SUNAT

Contexto de proyecto para Claude Code. **Leer esto primero** al retomar el trabajo.

## Qué es
App web (Next.js 14 App Router + TypeScript + Tailwind) para un estudio contable.
Por cada cliente: consulta estado SUNAT (RUC), SIRE (compras/ventas), buzón
electrónico, lectura de declaraciones (PDF) y comparativo vs SIRE, diagnóstico, dashboard
e **informe de gerencia** (PDF).

Marca: **ASENCO** (azul `brand-700`) + **IA** (negro). Logo cuadrado "A".

## Despliegue
- **Render**, runtime **node**, plan **standard** (2 GB — el buzón usa navegador headless).
- Branch de trabajo y `main` se mantienen iguales (push a ambos).
- Datos en `data/store.json` (JSON local). En Render **sin disco persistente los datos
  se borran en cada deploy** → al probar, recrear el cliente. (Activar disco = plan con disco.)
- Variables clave (Render → Environment): `DECOLECTA_TOKEN`. Resto de SUNAT se ingresan
  por consulta (Clave SOL + client_id/secret) y **no se guardan**.
- Commits terminan con `Co-Authored-By` y `Claude-Session` (ver git log).

## Arquitectura
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
- `src/lib/diagnostico.ts` — motor de hallazgos/score (incluye consistencia declaración vs SIRE).
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
