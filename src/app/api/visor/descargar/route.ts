import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getVisorToken } from "@/lib/db";
import { zipSync, strToU8 } from "fflate";

export const runtime = "nodejs";

// Genera un ZIP con la extensión (Manifest V3) y el TOKEN + URL de Radar ya
// incrustados. El usuario lo descomprime y lo carga en Chrome/Edge (modo dev).
export async function GET(_req: NextRequest) {
  const user = await requireUser();
  const token = await getVisorToken(user.id);
  const h = headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "radartributaria.com"}`;

  const sub = (s: string) => s.replaceAll("__TOKEN__", token).replaceAll("__RADAR__", origin);

  const manifest = JSON.stringify({
    manifest_version: 3,
    name: "Radar · Visor Tributario",
    version: "1.0.0",
    description: "Lee los datos de las páginas de SUNAT que abres y los envía a Radar para armar el reporte.",
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: ["https://*.sunat.gob.pe/*", `${origin}/*`],
    background: { service_worker: "background.js" },
    content_scripts: [{ matches: ["https://*.sunat.gob.pe/*"], js: ["content.js"], run_at: "document_start", all_frames: true }],
    web_accessible_resources: [{ resources: ["inject.js"], matches: ["https://*.sunat.gob.pe/*"] }],
    action: { default_popup: "popup.html", default_title: "Radar · Visor Tributario" },
  }, null, 2);

  const background = sub(`
const RADAR = "__RADAR__";
const TOKEN = "__TOKEN__";
// Identidad compartida entre frames (el frame del SIRE no puede leer el menú
// superior por ser de otro origen; el frame del menú sí ve la ventana flotante).
var identidad = { empresa: "", ruc: "" };
function normEmp(s) { return String(s || "").toUpperCase().replace(/\\.\\.\\.$/, "").replace(/\\s+/g, " ").trim(); }
function mismaEmpresa(a, b) {
  a = normEmp(a); b = normEmp(b);
  if (!a || !b) return false;
  var k = Math.min(a.length, b.length, 14);
  return a.slice(0, k) === b.slice(0, k);
}
// La empresa ACTUAL manda: al cambiar de empresa se reemplaza (y se descarta el
// RUC viejo). Un reporte con RUC viene de la ventana flotante y es autoritativo.
function mejorIdent(prev, inc) {
  inc = inc || {};
  var ir = (inc.ruc && String(inc.ruc).length === 11) ? String(inc.ruc) : "";
  if (ir) {
    if (prev.ruc && prev.ruc !== ir) return { empresa: inc.empresa || "", ruc: ir }; // cambió de empresa
    var emp = inc.empresa || "";
    if (prev.empresa && (!emp || (mismaEmpresa(prev.empresa, emp) && prev.empresa.length > emp.length))) emp = prev.empresa;
    return { empresa: emp, ruc: ir };
  }
  if (inc.empresa) {
    if (!prev.empresa) return { empresa: inc.empresa, ruc: prev.ruc || "" };
    if (!mismaEmpresa(prev.empresa, inc.empresa)) return { empresa: inc.empresa, ruc: "" }; // cambió de empresa
    var mejor = (inc.empresa.length > prev.empresa.length && !/\\.\\.\\.$/.test(inc.empresa)) ? inc.empresa : prev.empresa;
    return { empresa: mejor, ruc: prev.ruc || "" };
  }
  return prev;
}
async function enviar(payload) {
  try {
    if (payload && payload.datos && payload.datos.visor) {
      var v = payload.datos.visor;
      if (!v.empresa && identidad.empresa) v.empresa = identidad.empresa;
      // El RUC solo se rellena si es de la MISMA empresa (nunca el de otra).
      if (!v.ruc && identidad.ruc && (!v.empresa || mismaEmpresa(v.empresa, identidad.empresa))) v.ruc = identidad.ruc;
    }
    const r = await fetch(RADAR + "/api/visor/captura", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ token: TOKEN }, payload)),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, d };
  } catch (e) { return { ok: false, error: String(e) }; }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "identidad") { identidad = mejorIdent(identidad, msg.payload); return; }
  if (msg && msg.type === "captura") { enviar(msg.payload).then(sendResponse); return true; }
});
`);

  // Se inyecta en el CONTEXTO de la página para interceptar fetch/XHR de SUNAT.
  const inject = `
(function () {
  const RE = /rvierce|migeigv|omisos|resumencomprobantes|propuesta|padron|declaraci|reportetri|itconitf|rentasretenciones/i;
  function post(url, data) {
    try { window.postMessage({ __radarVisor: true, url: String(url), datos: data }, "*"); } catch (e) {}
  }
  const of = window.fetch;
  window.fetch = function (...a) {
    return of.apply(this, a).then((res) => {
      try {
        const url = (a[0] && a[0].url) || a[0];
        if (RE.test(String(url))) res.clone().text().then((t) => { let j = t; try { j = JSON.parse(t); } catch (e) {} post(url, j); }).catch(() => {});
      } catch (e) {}
      return res;
    });
  };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => { try { if (RE.test(String(this.__u))) { let j = this.responseText; try { j = JSON.parse(this.responseText); } catch (e) {} post(this.__u, j); } } catch (e) {} });
    return os.apply(this, arguments);
  };
})();
`;

  const content = `
// Envío SEGURO: si la extensión se recargó (contexto invalidado), no lanza error.
function SEND(payload, cb) {
  try {
    if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
    chrome.runtime.sendMessage({ type: "captura", payload: payload }, cb);
  } catch (e) { /* extension context invalidated: recarga la pestaña */ }
}
// Puente: inyecta el hook de red en la página y reenvía capturas a Radar.
try {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("inject.js");
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
} catch (e) {}
// Recuerda el último SIRE visto por red: codLibro 080000 = Compras (RCE),
// 140000 = Ventas (RVIE). Sirve para rotular el cuadro cuando el título no basta.
var ultimoSubSire = "";
window.addEventListener("message", (ev) => {
  const m = ev.data;
  if (!m || !m.__radarVisor) return;
  var u = String(m.url || "");
  if (/\\b140000\\b|rvie(?!rce)/i.test(u)) ultimoSubSire = "ventas";
  else if (/\\b080000\\b|\\brce\\b/i.test(u)) ultimoSubSire = "compras";
  SEND({ url: m.url, titulo: document.title, datos: m.datos });
});

// --- Escáner del DOM (SIRE / DJ): lee "MES/AÑO - Presentado / No Presentado" --
var MESN = { ENE:"01",FEB:"02",MAR:"03",ABR:"04",MAY:"05",JUN:"06",JUL:"07",AGO:"08",SEP:"09",SET:"09",OCT:"10",NOV:"11",DIC:"12" };
function textoPagina() {
  var partes = [];
  try { if (document.body) partes.push(document.body.innerText || ""); } catch (e) {}
  try {
    var nodos = document.querySelectorAll("option, li, [role='option'], .dijitMenuItem, .ui-menu-item, td, span");
    for (var i = 0; i < nodos.length; i++) { var s = (nodos[i].textContent || "").trim(); if (s && s.length < 60) partes.push(s); }
  } catch (e) {}
  return partes.join(" \\n ");
}
function empresaInfo() {
  var emp = "", ruc = "";
  // 1) Ventana flotante del usuario (arriba a la derecha): razón social y RUC
  //    COMPLETOS. textContent la lee aunque esté oculta (no requiere hover).
  try {
    var cand = document.querySelectorAll("div,section,table,ul,td");
    for (var i = 0; i < cand.length; i++) {
      var tc = (cand[i].textContent || "");
      if (tc.length > 500 || !/RUC:?\\s*\\d{11}/.test(tc)) continue;
      if (!/(Usuario:|Ver Ficha|OPERACIONES|Actualizar datos del RUC)/i.test(tc)) continue;
      var mr = tc.match(/RUC:?\\s*(\\d{11})/);
      var me = tc.match(/([A-Z\\u00d1\\u00c1\\u00c9\\u00cd\\u00d3\\u00da0-9][A-Z\\u00d1\\u00c1\\u00c9\\u00cd\\u00d3\\u00da0-9 .,&'\\/-]{4,120}?)\\s*RUC:?\\s*\\d{11}/);
      if (mr) ruc = mr[1];
      if (me) emp = me[1].replace(/\\s+/g, " ").trim();
      if (ruc) break;
    }
  } catch (e) {}
  // 2) Respaldo: texto visible (Bienvenido / razón social) de este frame y superiores.
  if (!emp || !ruc) {
    var partes = [];
    try { if (document.body) partes.push(document.body.innerText || ""); } catch (e) {}
    try { if (window.top && window.top !== window && window.top.document.body) partes.push(window.top.document.body.innerText || ""); } catch (e) {}
    try { if (window.parent && window.parent !== window && window.parent.document.body) partes.push(window.parent.document.body.innerText || ""); } catch (e) {}
    var txt = partes.join("\\n");
    if (!emp) emp = (txt.match(/raz[o\\u00f3]n social:?\\s*([^\\n]+)/i) || txt.match(/Bienvenido,?\\s*([^\\n]+?)\\s*(?:Domicilio|Salir|$)/i) || [])[1] || "";
    if (!ruc) ruc = (txt.match(/RUC:?\\s*(\\d{11})/i) || txt.match(/\\b(\\d{11})\\b/) || [])[1] || "";
  }
  emp = String(emp).replace(/^\\s*Bienvenido,?\\s*/i, "").replace(/\\s*\\.\\.\\.$/, "").replace(/\\s+/g, " ").trim();
  return { empresa: emp.slice(0, 140), ruc: ruc };
}
// Reporta la identidad (empresa/RUC) al background para que la comparta entre
// frames de distinto origen (el frame del SIRE no puede leer el menú superior).
function reportarIdentidad() {
  try {
    var info = empresaInfo();
    if ((info.ruc && info.ruc.length === 11) || (info.empresa && info.empresa.length > 4)) {
      if (chrome && chrome.runtime && chrome.runtime.id) chrome.runtime.sendMessage({ type: "identidad", payload: info });
    }
  } catch (e) {}
}
function tipoActual() {
  var t = (location.href + " " + document.title + " " + (document.body ? document.body.innerText : "")).toLowerCase();
  // DJ ANUAL PRIMERO: la consulta de Renta Anual (formulario 710/709 + Ejercicio).
  // "N\\u00famero de formulario" es el ancla exclusiva de esa pantalla; el menú
  // lateral comparte "renta anual" con la de mensual, por eso se exige el ancla.
  if (/renta anual/.test(t) && /n[u\\u00fa]mero de formulario/.test(t)) return "dj-anual";
  if (/formulario 710\\b|declaraci[o\\u00f3]n jurada anual del ejercicio/.test(t)) return "dj-anual";
  // DJ mensual (su contenido real).
  if (/consulta de declaraciones y pagos|declara f[a\\u00e1]cil|nro orden|renta mensual|pdt igv|\\b0621\\b/.test(t)) return "dj-mensual";
  // SIRE: separar Registro de COMPRAS (RCE) y VENTAS (RVIE). Prioriza el título
  // de la pantalla; si no, usa el último codLibro visto por red.
  var sub = subSireDom() || ultimoSubSire;
  return sub ? "sire-" + sub : "sire";
}
// Lee el TÍTULO principal de la pantalla SIRE (no el menú lateral, que lista
// ambos). "Registro de Compras Electrónico" / "Registro de Ventas e Ingresos".
function subSireDom() {
  try {
    var nodos = document.querySelectorAll("h1,h2,h3,h4,h5,legend,.panel-title,.page-title,.titulo,div,span,strong,b,td,th");
    for (var i = 0; i < nodos.length; i++) {
      var el = nodos[i];
      var s = (el.textContent || "").trim();
      if (!s || s.length > 55) continue;
      if (el.closest && el.closest("a")) continue; // salta enlaces del menú
      if (/^registro de compras/i.test(s)) return "compras";
      if (/^registro de ventas/i.test(s)) return "ventas";
    }
  } catch (e) {}
  return "";
}
// Ejercicio (año) seleccionado en el <select> de la consulta anual.
function anioEjercicio() {
  try {
    var sels = document.querySelectorAll("select");
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i];
      var v = (s.options && s.selectedIndex >= 0) ? String(s.options[s.selectedIndex].text || s.value) : String(s.value || "");
      var m = v.match(/^\\s*(20\\d{2})\\s*$/); if (m) return m[1];
    }
  } catch (e) {}
  return "";
}
function anioSel() {
  try {
    var ins = document.querySelectorAll("input, .dijitInputInner, [role='combobox']");
    for (var i = 0; i < ins.length; i++) { var val = (ins[i].value || ins[i].textContent || ""); var m = String(val).match(/\\b(20\\d{2})\\b/); if (m) return m[1]; }
  } catch (e) {}
  var mt = textoPagina().match(/\\b(20\\d{2})\\s*[-\\u2013]/); return mt ? mt[1] : "";
}
// SIRE: "MES/AÑO - Presentado / No Presentado".
function celdasSire() {
  var txt = textoPagina();
  if (!/Presentado/i.test(txt)) return null;
  var re = /\\b(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SET|SEP|OCT|NOV|DIC|20\\d{2})\\s*[-\\u2013]\\s*(No\\s+Presentado|Presentado)/gi;
  var anio = anioSel(); var celdas = {}, anios = {}, m;
  while ((m = re.exec(txt))) {
    var k = m[1].toUpperCase(); var e = /no/i.test(m[2]) ? "No Presentado" : "Presentado";
    if (/^20\\d{2}$/.test(k)) anios[k] = e;
    else if (MESN[k] && anio) celdas[anio + "-" + MESN[k]] = e;
  }
  return (Object.keys(celdas).length || Object.keys(anios).length) ? { celdas: celdas, anios: anios } : null;
}
// DJ mensual: la tabla lista los PRESENTADOS (Periodo MM/AAAA + Nro Orden). El
// rango "Desde MM/AAAA Hasta MM/AAAA" define los meses que debían estar → los que
// faltan = No Presentó.
var MESNOM = { ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,JULIO:7,AGOSTO:8,SETIEMBRE:9,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12 };
// Lee el rango del FORMULARIO (selectores mes/año), incluso cuando no hay tabla.
function rangoDjForm() {
  try {
    var sels = document.querySelectorAll("select");
    var meses = [], anios = [];
    for (var i = 0; i < sels.length; i++) {
      var s = sels[i];
      var vraw = String(s.value || "");
      var vtxt = (s.options && s.selectedIndex >= 0) ? String(s.options[s.selectedIndex].text || "") : vraw;
      var v = (vtxt || vraw).toUpperCase().trim();
      if (MESNOM[v]) meses.push(MESNOM[v]);
      else { var my = (vraw + " " + vtxt).match(/\\b(20\\d{2})\\b/); if (my) anios.push(parseInt(my[1], 10)); }
    }
    if (meses.length >= 2 && anios.length >= 2) return { m1: meses[0], y1: anios[0], m2: meses[1], y2: anios[1] };
  } catch (e) {}
  return null;
}
function celdasDjMensual() {
  var txt = document.body ? document.body.innerText : "";
  // Solo capturamos DESPUÉS de buscar: hay resultados o el aviso de "no existe".
  if (!/no existe formulario|Detalle de Declaraci|Nro Orden/i.test(txt)) return null;
  var pres = {};
  try {
    var trs = document.querySelectorAll("tr");
    for (var i = 0; i < trs.length; i++) {
      var rt = trs[i].innerText || "";
      var mp = rt.match(/\\b(0[1-9]|1[0-2])\\/(20\\d{2})\\b/);
      var mo = rt.match(/\\b\\d{9,}\\b/);
      if (mp && mo) pres[mp[2] + "-" + mp[1]] = 1;
    }
  } catch (e) {}
  // Rango: "Desde: MM/AAAA ... Hasta: MM/AAAA" (con resultados) o los selectores.
  var r1, m1, y1, m2, y2;
  var rg = txt.match(/Desde:\\s*(\\d{1,2})\\/(20\\d{2})[\\s\\S]*?Hasta:\\s*(\\d{1,2})\\/(20\\d{2})/i);
  if (rg) { m1 = parseInt(rg[1], 10); y1 = parseInt(rg[2], 10); m2 = parseInt(rg[3], 10); y2 = parseInt(rg[4], 10); }
  else { var f = rangoDjForm(); if (f) { m1 = f.m1; y1 = f.y1; m2 = f.m2; y2 = f.y2; } }
  var celdas = {};
  if (m1) {
    var yy = y1, mm = m1, g = 0;
    while ((yy < y2 || (yy === y2 && mm <= m2)) && g < 120) {
      var key = yy + "-" + (mm < 10 ? "0" + mm : "" + mm);
      celdas[key] = pres[key] ? "Presentado" : "No Presentado";
      mm++; if (mm > 12) { mm = 1; yy++; } g++;
    }
  } else { for (var k in pres) celdas[k] = "Presentado"; }
  return Object.keys(celdas).length ? { celdas: celdas, anios: {} } : null;
}
// DJ ANUAL: consulta por Ejercicio (año). Cada búsqueda da UN año:
//  - si hay una fila con Ejercicio (20xx) + Fecha de Presentación (dd/mm/aaaa) → Presentó.
//  - si "No hay registros disponibles" → el Ejercicio consultado = No Presentó.
// El cuadro es SOLO por año (no meses), porque es una declaración anual.
function celdasDjAnual() {
  var txt = document.body ? document.body.innerText : "";
  if (!/n[u\\u00fa]mero de formulario/i.test(txt)) return null; // ancla de la pantalla anual
  var anios = {};
  try {
    var trs = document.querySelectorAll("table tr");
    for (var i = 0; i < trs.length; i++) {
      var rt = trs[i].innerText || "";
      if (!/\\d{2}\\/\\d{2}\\/20\\d{2}/.test(rt)) continue;   // fila con fecha de presentación
      var my = rt.match(/\\b(20\\d{2})\\b/);                 // 1er 20xx = Ejercicio (antes de la fecha)
      if (my) anios[my[1]] = "Presentado";
    }
  } catch (e) {}
  if (/no hay registros disponibles/i.test(txt)) {
    var y = anioEjercicio(); if (y && !anios[y]) anios[y] = "No Presentado";
  }
  return Object.keys(anios).length ? { celdas: {}, anios: anios } : null;
}
function escanear() {
  var tipo = tipoActual();
  var r = tipo === "dj-anual" ? celdasDjAnual() : tipo === "dj-mensual" ? celdasDjMensual() : celdasSire();
  if (!r) return null;
  var info = empresaInfo();
  return { empresa: info.empresa, ruc: info.ruc, tipo: tipo, celdas: r.celdas, anios: r.anios };
}
var ultimaFirma = "";
function enviar() {
  var v = escanear(); if (!v) return;
  var firma = v.tipo + "|" + Object.keys(v.celdas).sort().map(function (k) { return k + v.celdas[k][0]; }).join("") + "|" + Object.keys(v.anios).sort().map(function (y) { return y + v.anios[y][0]; }).join("");
  if (firma === ultimaFirma) return;
  ultimaFirma = firma;
  SEND({ url: location.href, titulo: document.title, datos: { visor: v } });
}
// Rebote LARGO: espera ~3.5s tras el último cambio (que cargue todo el desplegable).
var deb;
function programar() { clearTimeout(deb); deb = setTimeout(enviar, 3500); }
try {
  var obs = new MutationObserver(programar);
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
} catch (e) {}
setInterval(programar, 8000);
setTimeout(enviar, 3000);
setTimeout(reportarIdentidad, 1500);
setInterval(reportarIdentidad, 5000);

// Captura manual (desde el popup): fuerza el envío inmediato.
chrome.runtime.onMessage.addListener((msg, s, send) => {
  if (msg && msg.type === "capturarPagina") {
    var v = escanear();
    var texto = (document.body ? document.body.innerText : "").slice(0, 20000);
    ultimaFirma = "";
    SEND({ url: location.href, titulo: document.title, texto: texto, datos: v ? { visor: v } : undefined }, (r) => send(r));
    return true;
  }
});
`;

  const popup = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:13px system-ui;margin:0;width:300px;padding:14px;color:#0f172a}
h1{font-size:14px;margin:0 0 6px}.b{background:#1e3a8a;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;width:100%}
.m{font-size:11px;color:#64748b;margin-top:8px}a{color:#1e3a8a}
</style></head><body>
<h1>Radar · Visor Tributario</h1>
<p class="m">Abre en SUNAT el SIRE, DJ mensual o DJ anual y esta extensión captura los datos sola. Si quieres forzar el envío de la pantalla actual, usa el botón.</p>
<button class="b" id="cap">Capturar esta pantalla</button>
<p class="m" id="st"></p>
<p class="m">Ver capturas en <a href="__RADAR__/herramientas/visor" target="_blank">Radar → Visor</a></p>
<script src="popup.js"></script></body></html>`;

  const popupJs = sub(`
document.getElementById("cap").addEventListener("click", async () => {
  const st = document.getElementById("st"); st.textContent = "Enviando…";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/sunat\\.gob\\.pe/.test(tab.url || "")) { st.textContent = "Abre una página de SUNAT primero."; return; }
  chrome.tabs.sendMessage(tab.id, { type: "capturarPagina" }, (r) => {
    st.textContent = r && r.ok ? "✔ Enviado a Radar (" + (r.d && r.d.tipo || "otro") + ")" : "No se pudo enviar.";
  });
});
`);

  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(manifest),
    "background.js": strToU8(background),
    "inject.js": strToU8(inject),
    "content.js": strToU8(content),
    "popup.html": strToU8(sub(popup)),
    "popup.js": strToU8(popupJs),
    "LEEME.txt": strToU8(sub("Radar - Visor Tributario\n\nInstalar (Chrome/Edge):\n1) Descomprime esta carpeta.\n2) Ve a chrome://extensions (o edge://extensions).\n3) Activa 'Modo de desarrollador'.\n4) 'Cargar descomprimida' y elige esta carpeta.\n5) Inicia sesion en SUNAT normalmente y navega SIRE / DJ.\n\nTu token ya viene incrustado. Las capturas llegan a __RADAR__/herramientas/visor")),
  };

  const zip = zipSync(files, { level: 6 });
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="radar-visor-tributario.zip"`,
    },
  });
}
