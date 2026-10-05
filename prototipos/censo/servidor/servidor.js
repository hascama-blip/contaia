#!/usr/bin/env node
// Servidor del Portal Inmaculada Concepción — para AWS Lightsail (o cualquier
// máquina con Node 22). Sin dependencias. Reemplaza lo que en claude.ai daba
// el artifact: base de datos, archivos, usuario y avisos en vivo.
//
//   node servidor/servidor.js            (puerto 3000, datos en servidor/datos)
//   DATOS=/var/censo PUERTO=3000 node servidor/servidor.js
//
// Rutas:
//   GET  /, /index.html, /src/*, /estilos/*, /img/*   la web (con sesión)
//   GET  /login.html, POST/GET/DELETE /api/sesion      entrar / quién soy / salir
//   GET  /api/db/:col · GET/PUT/PATCH/DELETE /api/db/:col/:id
//   GET  /api/eventos                                  SSE: {col} cuando algo cambia
//   POST /api/archivos · GET /_blob/:id · DELETE /api/archivos/:id
//   GET  /api/usuarios · POST · PATCH/DELETE /api/usuarios/:id   (admin)
//   GET  /api/usuarios/perfiles?ids=a,b                nombres para "registrado por"
//   GET  /api/reniec/:dni                              consulta DNI (token en el servidor)
//   POST /api/instalacion                              primer admin (código CENSO_CODIGO_INSTALACION, solo sin usuarios)
//   GET  /admin.html · GET /api/exportar · POST /api/importar · GET/POST /api/dominio   (admin)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Almacen, nuevoId, COLECCIONES } from "./lib/almacen.js";
import { Usuarios, COOKIE, puedeEscribir, esAdmin } from "./lib/sesiones.js";
import { Reniec } from "./lib/reniec.js";
import { json, cookies, leerCuerpo, leerJSON, servirArchivo, redirigir } from "./lib/http.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_WEB = path.resolve(AQUI, "..");            // carpeta censo (index.html, src, estilos, img)
const PUBLICO = path.join(AQUI, "publico");           // login.html, adaptador.js
const DATOS = path.resolve(process.env.DATOS || path.join(AQUI, "datos"));
const PUERTO = Number(process.env.PUERTO || 3000);
const MAX_ARCHIVO = 20 * 1048576;
const TRAS_PROXY = process.env.TRAS_PROXY !== "false"; // detrás de Caddy/nginx: cookies Secure

fs.mkdirSync(path.join(DATOS, "archivos"), { recursive: true });
const almacen = new Almacen(DATOS);
const usuarios = new Usuarios(DATOS);
const reniec = new Reniec(DATOS);
const metaArchivos = (() => {
  const ruta = path.join(DATOS, "archivos.json");
  let m; try { m = JSON.parse(fs.readFileSync(ruta, "utf8")); } catch { m = {}; }
  return { get: (id) => m[id], set: (id, v) => { m[id] = v; fs.writeFileSync(ruta, JSON.stringify(m)); }, del: (id) => { delete m[id]; fs.writeFileSync(ruta, JSON.stringify(m)); } };
})();

// ---- Avisos en vivo (SSE) ----
const oyentes = new Set();
almacen.on("cambio", (col) => { for (const res of oyentes) res.write(`data: ${JSON.stringify({ col })}\n\n`); });
setInterval(() => { for (const res of oyentes) res.write(": latido\n\n"); }, 25_000).unref();

// ---- Tope de intentos de entrada (por IP) ----
const intentos = new Map();
function intentoPermitido(ip) {
  const ahora = Date.now();
  const v = intentos.get(ip);
  if (!v || v.hasta < ahora) { intentos.set(ip, { hasta: ahora + 15 * 60_000, n: 1 }); return true; }
  return ++v.n <= 10;
}

const codigoInstalacionValido = (c) => {
  const esperado = String(process.env.CENSO_CODIGO_INSTALACION || "").trim();
  const dado = String(c || "").trim();
  return esperado.length >= 8 && dado.length === esperado.length && crypto.timingSafeEqual(Buffer.from(dado), Buffer.from(esperado));
};
const leerDominio = () => { try { return fs.readFileSync(path.join(DATOS, "dominio.txt"), "utf8").trim().split(/\s+/)[0] || ""; } catch { return ""; } };
const ipDe = (req) => (TRAS_PROXY && req.headers["x-forwarded-for"]) ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : req.socket.remoteAddress;
const seguro = (req) => TRAS_PROXY ? req.headers["x-forwarded-proto"] === "https" : false;

function inyectarAdaptador(html) {
  // La web carga el adaptador antes de su código: así window.claude existe.
  return html.replace('<script type="module" src="src/main.js"></script>',
    '<script>window.__CONSULTA_DNI__ = { url: "/api/reniec", clave: "sesion" };</script>\n<script src="/adaptador.js"></script>\n<script type="module" src="src/main.js"></script>');
}

async function manejar(req, res) {
  const url = new URL(req.url, "http://x");
  const ruta = url.pathname;
  const metodo = req.method;
  const yo = usuarios.deCookie(cookies(req)[COOKIE]);

  // ---- Público: entrar ----
  if (ruta === "/login.html" || ruta === "/adaptador.js" || ruta === "/estilos.login.css") {
    if (ruta === "/login.html" && yo) return redirigir(res, "/");
    return servirArchivo(res, PUBLICO, ruta) || json(res, 404, { error: "No existe." });
  }
  if (ruta === "/api/instalacion" && metodo === "POST") {
    // Primera configuración: solo mientras no exista ningún usuario y con el código de instalación.
    if (usuarios.lista.length) return json(res, 409, { error: "El portal ya tiene usuarios. Entra con tu cuenta." });
    if (!intentoPermitido(ipDe(req))) return json(res, 429, { error: "Demasiados intentos. Espera 15 minutos." });
    const { codigo, usuario, nombre, clave } = await leerJSON(req, 4096);
    if (!codigoInstalacionValido(codigo)) return json(res, 401, { error: "Código de instalación incorrecto." });
    const creado = usuarios.crear({ usuario, nombre, clave, rol: "admin" });
    intentos.delete(ipDe(req));
    return json(res, 200, { usuario: creado }, { "Set-Cookie": usuarios.emitirCookie(usuarios.porId(creado.id), seguro(req)) });
  }
  if (ruta === "/api/sesion") {
    if (metodo === "POST") {
      if (!intentoPermitido(ipDe(req))) return json(res, 429, { error: "Demasiados intentos. Espera 15 minutos." });
      const { usuario, clave } = await leerJSON(req, 4096);
      const u = usuarios.verificar(usuario, clave);
      if (!u) return json(res, 401, { error: "Usuario o clave incorrectos." });
      intentos.delete(ipDe(req)); // entrar bien limpia el contador de intentos fallidos
      return json(res, 200, { usuario: usuarios.publico(u) }, { "Set-Cookie": usuarios.emitirCookie(u, seguro(req)) });
    }
    if (metodo === "DELETE") return json(res, 200, { ok: true }, { "Set-Cookie": usuarios.cookieSalida() });
    if (metodo === "GET") return json(res, yo ? 200 : 401, yo ? { usuario: usuarios.publico(yo), puedeEscribir: puedeEscribir(yo), esAdmin: esAdmin(yo) } : { error: "No autenticado", instalar: usuarios.lista.length === 0 });
  }
  // Estáticos públicos que la página de entrada necesita (logo, estilos).
  if (ruta.startsWith("/estilos/") || ruta.startsWith("/img/")) {
    return servirArchivo(res, RAIZ_WEB, ruta, { cache: "public, max-age=3600" }) || json(res, 404, { error: "No existe." });
  }

  // ---- Todo lo demás exige sesión ----
  if (!yo) {
    if (ruta.startsWith("/api/") || ruta.startsWith("/_blob/")) return json(res, 401, { error: "No autenticado", code: "revoked" });
    return redirigir(res, "/login.html");
  }
  const escribe = puedeEscribir(yo);
  const soloLectura = () => json(res, 403, { error: "Tu usuario es de solo lectura.", code: "invalid_argument" });

  // ---- Base de datos ----
  let m;
  if ((m = ruta.match(/^\/api\/db\/([a-z]+)(?:\/([A-Za-z0-9_.-]+))?$/))) {
    const [, col, id] = m;
    if (!COLECCIONES.includes(col)) return json(res, 404, { error: "Colección desconocida." });
    if (metodo === "GET" && !id) return json(res, 200, { docs: almacen.listar(col) });
    if (metodo === "GET") { const d = almacen.obtener(col, id); return d ? json(res, 200, d) : json(res, 404, { error: "No existe.", code: "not_found" }); }
    if (!escribe) return soloLectura();
    if (metodo === "PUT") { almacen.establecer(col, id, await leerJSON(req)); return json(res, 200, { ok: true }); }
    if (metodo === "PATCH") { almacen.actualizar(col, id, await leerJSON(req)); return json(res, 200, { ok: true }); }
    if (metodo === "DELETE") { almacen.borrar(col, id); return json(res, 200, { ok: true }); }
  }
  if (ruta === "/api/eventos" && metodo === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(": conectado\n\n");
    oyentes.add(res);
    req.on("close", () => oyentes.delete(res));
    return;
  }

  // ---- Archivos (fotos, firmas, documentos) ----
  if (ruta === "/api/archivos" && metodo === "POST") {
    if (!escribe) return soloLectura();
    const tipo = String(req.headers["content-type"] || "application/octet-stream").split(";")[0];
    if (!/^(image\/|application\/pdf|text\/|application\/json)/.test(tipo)) return json(res, 415, { error: "Tipo de archivo no permitido.", code: "unsupported_type" });
    const cuerpo = await leerCuerpo(req, MAX_ARCHIVO);
    const id = nuevoId() + nuevoId();
    fs.writeFileSync(path.join(DATOS, "archivos", id), cuerpo);
    metaArchivos.set(id, { tipo, tamano: cuerpo.length, nombre: decodeURIComponent(String(req.headers["x-nombre"] || "")), por: yo.id, en: new Date().toISOString() });
    return json(res, 200, { id, url: `/_blob/${id}`, sizeBytes: cuerpo.length, contentType: tipo });
  }
  if ((m = ruta.match(/^\/api\/archivos\/([A-Za-z0-9]+)$/)) && metodo === "DELETE") {
    if (!escribe) return soloLectura();
    try { fs.unlinkSync(path.join(DATOS, "archivos", m[1])); } catch { /* ya no estaba */ }
    metaArchivos.del(m[1]);
    return json(res, 200, { deleted: true });
  }
  if ((m = ruta.match(/^\/_blob\/([A-Za-z0-9]+)$/))) {
    const meta = metaArchivos.get(m[1]);
    const abs = path.join(DATOS, "archivos", m[1]);
    if (!meta || !fs.existsSync(abs)) return json(res, 404, { error: "Archivo no encontrado." });
    res.writeHead(200, { "Content-Type": meta.tipo, "Content-Length": meta.tamano, "Cache-Control": "private, max-age=86400", "Content-Disposition": `inline; filename="${encodeURIComponent(meta.nombre || m[1])}"`, "X-Content-Type-Options": "nosniff" });
    return fs.createReadStream(abs).pipe(res);
  }

  // ---- Usuarios ----
  if (ruta === "/api/usuarios/perfiles" && metodo === "GET") {
    const ids = String(url.searchParams.get("ids") || "").split(",").filter(Boolean);
    return json(res, 200, Object.fromEntries(ids.map((id) => [id, usuarios.porId(id) ? { id, name: usuarios.porId(id).nombre } : null])));
  }
  if (ruta === "/api/usuarios" || (m = ruta.match(/^\/api\/usuarios\/(u_[a-f0-9]+)$/))) {
    if (!esAdmin(yo)) return json(res, 403, { error: "Solo un administrador maneja usuarios." });
    if (ruta === "/api/usuarios" && metodo === "GET") return json(res, 200, { usuarios: usuarios.lista.map((u) => usuarios.publico(u)) });
    if (ruta === "/api/usuarios" && metodo === "POST") return json(res, 200, { usuario: usuarios.crear(await leerJSON(req, 4096)) });
    if (m && metodo === "PATCH") {
      const c = await leerJSON(req, 4096);
      if (c.clave) usuarios.cambiarClave(m[1], c.clave);
      if (c.rol) usuarios.cambiarRol(m[1], c.rol);
      return json(res, 200, { ok: true });
    }
    if (m && metodo === "DELETE") { usuarios.borrar(m[1]); return json(res, 200, { ok: true }); }
  }

  // ---- Administración (solo admin): respaldo, importación, dominio ----
  if (ruta === "/admin.html" || ruta === "/api/exportar" || ruta === "/api/importar" || ruta === "/api/dominio") {
    if (!esAdmin(yo)) return ruta === "/admin.html" ? redirigir(res, "/") : json(res, 403, { error: "Solo un administrador." });
    if (ruta === "/admin.html") return servirArchivo(res, PUBLICO, ruta) || json(res, 404, { error: "No existe." });
    if (ruta === "/api/exportar" && metodo === "GET") {
      const colecciones = Object.fromEntries(COLECCIONES.map((c) => [c, almacen.listar(c)]));
      return json(res, 200, { exportadoAt: new Date().toISOString(), colecciones }, { "Content-Disposition": `attachment; filename="censo-respaldo-${new Date().toISOString().slice(0, 10)}.json"` });
    }
    if (ruta === "/api/importar" && metodo === "POST") {
      const cuerpo = await leerJSON(req, 64 * 1048576);
      const conteo = Object.fromEntries(COLECCIONES.map((c) => [c, 0]));
      if (Array.isArray(cuerpo)) { // semilla.json: [{ path:"col/id", data }]
        for (const { path: ruta2, data } of cuerpo) { const [col, id] = String(ruta2 || "").split("/"); if (COLECCIONES.includes(col) && id && data) { almacen.establecer(col, id, data); conteo[col]++; } }
      } else if (cuerpo && cuerpo.colecciones) { // respaldo de /api/exportar
        for (const col of COLECCIONES) for (const d of cuerpo.colecciones[col] || []) if (d && d.id && d.data) { almacen.establecer(col, d.id, d.data); conteo[col]++; }
      } else return json(res, 400, { error: "Formato no reconocido: se espera semilla.json o un respaldo del portal." });
      almacen.vaciar();
      return json(res, 200, { importado: conteo });
    }
    if (ruta === "/api/dominio" && metodo === "GET") return json(res, 200, { dominio: leerDominio() });
    if (ruta === "/api/dominio" && metodo === "POST") {
      const { dominio, correo } = await leerJSON(req, 4096);
      const d = String(dominio || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (d && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) return json(res, 400, { error: "Dominio inválido. Ejemplo: inmaculadaconcepcion.pe" });
      // Lo lee censo-dominio.path (systemd, root), que regenera el Caddyfile y recarga Caddy.
      fs.writeFileSync(path.join(DATOS, "dominio.txt"), d ? `${d} ${String(correo || "").trim()}\n` : "");
      return json(res, 200, { dominio: d, aviso: d ? "En 1 o 2 minutos el servidor pedirá el certificado HTTPS. Antes, los registros A de GoDaddy deben apuntar a esta IP." : "Dominio quitado; el portal queda solo por IP." });
    }
  }

  // ---- RENIEC ----
  if ((m = ruta.match(/^\/api\/reniec\/(\d+)$/)) && metodo === "GET") {
    if (!escribe) return soloLectura();
    const persona = await reniec.consultar(m[1], { forzar: url.searchParams.get("forzar") === "1" });
    return json(res, 200, { persona, simulado: !reniec.real });
  }

  // ---- La web ----
  if (ruta === "/" || ruta === "/index.html") return servirArchivo(res, RAIZ_WEB, "/index.html", { transformar: inyectarAdaptador });
  if (ruta.startsWith("/src/")) return servirArchivo(res, RAIZ_WEB, ruta) || json(res, 404, { error: "No existe." });
  return json(res, 404, { error: "No existe." });
}

const servidor = http.createServer((req, res) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  manejar(req, res).catch((e) => {
    if (res.headersSent) return res.end();
    json(res, e?.status || 500, { error: e?.message || "Error interno.", ...(e?.code ? { code: e.code } : {}) });
    if (!e?.status) console.error(e);
  });
});

servidor.listen(PUERTO, () => {
  console.log(`Portal en http://localhost:${PUERTO} · datos en ${DATOS} · usuarios: ${usuarios.lista.length}${usuarios.lista.length ? "" : "  ← crea uno: node servidor/usuarios.js crear"}`);
});
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { almacen.vaciar(); process.exit(0); });
