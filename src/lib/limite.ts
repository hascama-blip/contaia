// ============================================================
//  Límite de intentos (anti fuerza bruta / anti spam), en memoria
// ============================================================
// Ventana deslizante por clave (IP, correo, usuario…). Vive en memoria del
// proceso (globalThis), suficiente para un solo servidor; se reinicia con cada
// despliegue. Las claves viejas se limpian solas.

import { NextRequest, NextResponse } from "next/server";

type Registro = number[]; // marcas de tiempo (ms)
const g = globalThis as unknown as { __radarLimites?: Map<string, Registro>; __radarLimitesPoda?: number };
const mapa: Map<string, Registro> = g.__radarLimites ?? (g.__radarLimites = new Map());

function podar(ahora: number) {
  if ((g.__radarLimitesPoda ?? 0) > ahora - 60_000) return;
  g.__radarLimitesPoda = ahora;
  for (const [k, v] of Array.from(mapa.entries())) {
    if (!v.length || v[v.length - 1] < ahora - 24 * 3600_000) mapa.delete(k);
  }
}

/** IP del cliente (Caddy fija X-Forwarded-For con la IP real). */
export function ipDe(req: NextRequest | Request): string {
  const h = req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "local").trim();
}

/** Registra un intento. Devuelve los segundos a esperar si se pasó del máximo (0 = permitido). */
export function intentar(clave: string, max: number, ventanaMs: number): number {
  const ahora = Date.now();
  podar(ahora);
  const r = (mapa.get(clave) ?? []).filter((t) => t > ahora - ventanaMs);
  if (r.length >= max) {
    mapa.set(clave, r);
    return Math.max(1, Math.ceil((r[0] + ventanaMs - ahora) / 1000));
  }
  r.push(ahora);
  mapa.set(clave, r);
  return 0;
}

/** Borra los intentos de una clave (p. ej. tras un inicio de sesión correcto). */
export function reiniciar(clave: string) {
  mapa.delete(clave);
}

/** Respuesta 429 estándar. */
export function demasiados(seg: number, texto = "Demasiados intentos.") {
  const min = Math.ceil(seg / 60);
  return NextResponse.json(
    { error: `${texto} Espera ${seg < 90 ? `${seg} s` : `${min} min`} e inténtalo de nuevo.`, esperar: seg },
    { status: 429, headers: { "Retry-After": String(seg) } },
  );
}

/** Atajo: aplica varios límites; devuelve la respuesta 429 o null. */
export function limitar(reglas: { clave: string; max: number; ventanaMs: number }[], texto?: string): NextResponse | null {
  for (const r of reglas) {
    const seg = intentar(r.clave, r.max, r.ventanaMs);
    if (seg) return demasiados(seg, texto);
  }
  return null;
}

export const MIN = 60_000;
export const HORA = 3_600_000;

/** Lee el cuerpo como texto, cortando si pasa de `max` bytes (para rutas
 *  públicas: evita que un envío gigante agote la memoria). null = demasiado grande. */
export async function leerCuerpoLimitado(req: Request, max: number): Promise<string | null> {
  const declarado = Number(req.headers.get("content-length") || "0");
  if (declarado > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    partes.push(value);
  }
  return Buffer.concat(partes.map((p) => Buffer.from(p))).toString("utf8");
}
