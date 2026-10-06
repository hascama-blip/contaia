// Utilidades HTTP mínimas (sin dependencias): JSON, cookies, cuerpo, estáticos.
import fs from "node:fs";
import path from "node:path";

export const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

export function json(res, status, cuerpo, cabeceras = {}) {
  const b = Buffer.from(JSON.stringify(cuerpo));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": b.length, "Cache-Control": "no-store", ...cabeceras });
  res.end(b);
}

export function cookies(req) {
  const out = {};
  for (const par of String(req.headers.cookie || "").split(";")) {
    const i = par.indexOf("=");
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}

/** Lee el cuerpo completo (con tope). Lanza { status: 413 } si se pasa. */
export function leerCuerpo(req, maxBytes) {
  return new Promise((ok, mal) => {
    const partes = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) { mal({ status: 413, message: `El archivo supera el máximo (${Math.round(maxBytes / 1048576)} MB).` }); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => ok(Buffer.concat(partes)));
    req.on("error", mal);
  });
}

export async function leerJSON(req, maxBytes = 2 * 1048576) {
  const b = await leerCuerpo(req, maxBytes);
  if (!b.length) return {};
  try { return JSON.parse(b.toString("utf8")); } catch { throw { status: 400, message: "JSON inválido." }; }
}

/** Sirve un archivo dentro de `raiz` (nunca fuera). Devuelve false si no existe. */
export function servirArchivo(res, raiz, ruta, { cache = "no-cache", transformar = null } = {}) {
  const limpio = path.normalize(decodeURIComponent(ruta)).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(raiz, limpio);
  if (!abs.startsWith(raiz)) return false;
  let st;
  try { st = fs.statSync(abs); } catch { return false; }
  if (!st.isFile()) return false;
  const tipo = TIPOS[path.extname(abs).toLowerCase()] || "application/octet-stream";
  if (transformar) {
    const b = Buffer.from(transformar(fs.readFileSync(abs, "utf8")));
    res.writeHead(200, { "Content-Type": tipo, "Content-Length": b.length, "Cache-Control": cache });
    res.end(b);
  } else {
    res.writeHead(200, { "Content-Type": tipo, "Content-Length": st.size, "Cache-Control": cache });
    fs.createReadStream(abs).pipe(res);
  }
  return true;
}

export function redirigir(res, a) {
  res.writeHead(302, { Location: a });
  res.end();
}
