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
  const RE = /sire|migeigv|rvierce|omisos|propuesta|declaracion|itmenu|reporte|consulta/i;
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
// Puente: inyecta el hook en la página y reenvía capturas a Radar.
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
// Captura manual (desde el popup): manda el texto visible de la página.
chrome.runtime.onMessage.addListener((msg, s, send) => {
  if (msg && msg.type === "capturarPagina") {
    const texto = (document.body ? document.body.innerText : "").slice(0, 20000);
    chrome.runtime.sendMessage({ type: "captura", payload: { url: location.href, titulo: document.title, texto } }, (r) => send(r));
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
