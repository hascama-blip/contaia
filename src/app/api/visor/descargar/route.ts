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
async function enviar(payload) {
  try {
    const r = await fetch(RADAR + "/api/visor/captura", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ token: TOKEN }, payload)),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, d };
  } catch (e) { return { ok: false, error: String(e) }; }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
// Puente: inyecta el hook de red en la página y reenvía capturas a Radar.
try {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("inject.js");
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();
} catch (e) {}
window.addEventListener("message", (ev) => {
  const m = ev.data;
  if (!m || !m.__radarVisor) return;
  chrome.runtime.sendMessage({ type: "captura", payload: { url: m.url, titulo: document.title, datos: m.datos } });
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
  var txt = document.body ? document.body.innerText : "";
  var emp = (txt.match(/raz[o\\u00f3]n social:\\s*([^\\n]+)/i) || txt.match(/Bienvenido,\\s*([^\\n]+?)\\s*(?:Domicilio|Salir|$)/i) || [])[1] || "";
  var ruc = (txt.match(/RUC:?\\s*(\\d{11})/i) || txt.match(/\\b(\\d{11})\\b/) || [])[1] || "";
  return { empresa: emp.trim().slice(0, 120), ruc: ruc };
}
function tipoActual() {
  var t = (location.href + " " + document.title + " " + (document.body ? document.body.innerText : "")).toLowerCase();
  if (/renta anual|declaraci[o\\u00f3]n.*anual|formulario 710|dj anual/.test(t)) return "dj-anual";
  if (/declaraciones y pagos|declara f[a\\u00e1]cil|nro orden|igv.?renta mensual|pdt igv|\\b0621\\b/.test(t)) return "dj-mensual";
  return "sire";
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
function celdasDjMensual() {
  var txt = document.body ? document.body.innerText : "";
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
  // Rango consultado: "Desde: MM/AAAA ... Hasta: MM/AAAA" (detalle de resultados)
  // o, de respaldo, el formulario "Rango de Periodo tributario" con nombres de mes.
  var MESNOM = { ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,JULIO:7,AGOSTO:8,SETIEMBRE:9,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12 };
  var rg = txt.match(/Desde:\\s*(\\d{1,2})\\/(20\\d{2})[\\s\\S]*?Hasta:\\s*(\\d{1,2})\\/(20\\d{2})/i);
  if (!rg) {
    var fm = txt.match(/Rango de Periodo[\\s\\S]{0,120}?\\b([A-Z]{4,10})\\s+(20\\d{2})[\\s\\S]{0,80}?\\b([A-Z]{4,10})\\s+(20\\d{2})/i);
    if (fm && MESNOM[fm[1].toUpperCase()] && MESNOM[fm[3].toUpperCase()]) {
      rg = [fm[0], String(MESNOM[fm[1].toUpperCase()]), fm[2], String(MESNOM[fm[3].toUpperCase()]), fm[4]];
    }
  }
  var celdas = {};
  if (rg) {
    var yy = parseInt(rg[2], 10), mm = parseInt(rg[1], 10), y2 = parseInt(rg[4], 10), m2 = parseInt(rg[3], 10), g = 0;
    while ((yy < y2 || (yy === y2 && mm <= m2)) && g < 120) {
      var key = yy + "-" + (mm < 10 ? "0" + mm : "" + mm);
      celdas[key] = pres[key] ? "Presentado" : "No Presentado";
      mm++; if (mm > 12) { mm = 1; yy++; } g++;
    }
  } else { for (var k in pres) celdas[k] = "Presentado"; }
  return Object.keys(celdas).length ? { celdas: celdas, anios: {} } : null;
}
function escanear() {
  var tipo = tipoActual();
  var r = tipo === "dj-mensual" ? celdasDjMensual() : celdasSire();
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
  chrome.runtime.sendMessage({ type: "captura", payload: { url: location.href, titulo: document.title, datos: { visor: v } } });
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

// Captura manual (desde el popup): fuerza el envío inmediato.
chrome.runtime.onMessage.addListener((msg, s, send) => {
  if (msg && msg.type === "capturarPagina") {
    var v = escanear();
    var texto = (document.body ? document.body.innerText : "").slice(0, 20000);
    ultimaFirma = "";
    chrome.runtime.sendMessage({ type: "captura", payload: { url: location.href, titulo: document.title, texto: texto, datos: v ? { visor: v } : undefined } }, (r) => send(r));
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
