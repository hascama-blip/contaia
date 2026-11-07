// ============================================================
//  Registro de accesos (evidencia): quién, cuándo, desde dónde y sobre qué RUC
// ============================================================
// Archivo aparte del store: DATA_DIR/accesos/AAAA-MM.jsonl (una línea por
// evento, solo se agrega al final). Cada línea lleva una FIRMA HMAC con la
// llave del servidor: si alguien edita o inventa una línea, la firma no cuadra.
// Lo alimentan getCurrentUser (cada página y cada API con sesión, vía
// anotarPeticion) y las rutas de login/registro/aceptación.
// Se conserva 5 años (ver Declaración de responsabilidad, punto 4).

import { promises as fs } from "fs";
import path from "path";
import { createHmac, timingSafeEqual } from "crypto";

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
export const ACCESOS_DIR = path.join(DATA_DIR, "accesos");
const MESES_A_CONSERVAR = 60;

export interface EventoAcceso {
  /** Fecha/hora ISO (UTC). */
  at: string;
  /** Tipo: navegación/consulta con sesión, inicio de sesión, aceptación de políticas… */
  ev: "pagina" | "api" | "login" | "login-fallido" | "registro" | "verificacion" | "aceptacion" | "logout";
  uid?: string;
  email?: string;
  ip: string;
  ua?: string;
  metodo?: string;
  ruta?: string;
  /** Empresa afectada (si la ruta es de un cliente). */
  clienteId?: string;
  ruc?: string;
  razonSocial?: string;
  detalle?: string;
}

function llave(): Buffer {
  const base = process.env.VIGILANCIA_KEY || process.env.AUTH_SECRET || "radar-tributario-dev-secret-cambiar-en-produccion";
  return createHmac("sha256", "registro-accesos").update(base).digest();
}
function firmar(json: string): string {
  return createHmac("sha256", llave()).update(json).digest("base64url");
}

// ---- Índice id → correo / RUC (se lee del store.json, con caché) ----------
type Indice = { usuarios: Map<string, string>; clientes: Map<string, { ruc: string; razonSocial: string }> };
const g = globalThis as unknown as { __radarIdxAccesos?: { idx: Indice; mtime: number; leido: number } };

async function indice(): Promise<Indice | null> {
  const ahora = Date.now();
  const c = g.__radarIdxAccesos;
  if (c && ahora - c.leido < 15_000) return c.idx;
  try {
    const archivo = path.join(DATA_DIR, "store.json");
    const st = await fs.stat(archivo);
    if (c && c.mtime === st.mtimeMs) { c.leido = ahora; return c.idx; }
    const raw = JSON.parse(await fs.readFile(archivo, "utf-8")) as { users?: { id: string; email: string }[]; clientes?: { id: string; ruc?: string; razonSocial?: string }[] };
    const idx: Indice = {
      usuarios: new Map((raw.users ?? []).map((u) => [u.id, u.email])),
      clientes: new Map((raw.clientes ?? []).map((cl) => [cl.id, { ruc: cl.ruc ?? "", razonSocial: cl.razonSocial ?? "" }])),
    };
    g.__radarIdxAccesos = { idx, mtime: st.mtimeMs, leido: ahora };
    return idx;
  } catch {
    return c?.idx ?? null;
  }
}

let ultimaPoda = "";
async function podar(mes: string) {
  if (ultimaPoda === mes) return;
  ultimaPoda = mes;
  try {
    const archivos = (await fs.readdir(ACCESOS_DIR)).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort();
    for (const f of archivos.slice(0, Math.max(0, archivos.length - MESES_A_CONSERVAR))) await fs.unlink(path.join(ACCESOS_DIR, f)).catch(() => {});
  } catch { /* sin carpeta aún */ }
}

/** Agrega un evento al registro. Nunca lanza (el registro no debe tumbar la web). */
export async function registrarAcceso(e: Omit<EventoAcceso, "at"> & { at?: string }): Promise<void> {
  try {
    const idx = (e.uid && !e.email) || (e.clienteId && !e.ruc) ? await indice() : null;
    const ev: EventoAcceso = { at: e.at ?? new Date().toISOString(), ...e };
    if (idx && ev.uid && !ev.email) ev.email = idx.usuarios.get(ev.uid);
    if (idx && ev.clienteId && !ev.ruc) {
      const cl = idx.clientes.get(ev.clienteId);
      if (cl) { ev.ruc = cl.ruc; ev.razonSocial = cl.razonSocial; }
    }
    if (ev.ua) ev.ua = ev.ua.slice(0, 300);
    if (ev.ruta) ev.ruta = ev.ruta.slice(0, 300);
    for (const k of Object.keys(ev) as (keyof EventoAcceso)[]) if (ev[k] === undefined || ev[k] === "") delete ev[k];
    const json = JSON.stringify(ev);
    const mes = ev.at.slice(0, 7);
    await fs.mkdir(ACCESOS_DIR, { recursive: true });
    await fs.appendFile(path.join(ACCESOS_DIR, `${mes}.jsonl`), JSON.stringify({ ...ev, firma: firmar(json) }) + "\n", "utf-8");
    void podar(mes);
  } catch (err) {
    console.error("[accesos] no se pudo registrar:", (err as Error)?.message);
  }
}

/** Meses con registro (AAAA-MM), del más reciente al más antiguo. */
export async function mesesConAccesos(): Promise<string[]> {
  try {
    return (await fs.readdir(ACCESOS_DIR)).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 7)).sort().reverse();
  } catch { return []; }
}

/** Lee los eventos de un mes con filtros; marca si la firma de cada línea es válida. */
export async function leerAccesos(mes: string, filtro: { ruc?: string; email?: string } = {}): Promise<(EventoAcceso & { integro: boolean })[]> {
  if (!/^\d{4}-\d{2}$/.test(mes)) return [];
  let raw = "";
  try { raw = await fs.readFile(path.join(ACCESOS_DIR, `${mes}.jsonl`), "utf-8"); } catch { return []; }
  const ruc = (filtro.ruc ?? "").replace(/\D/g, "");
  const email = (filtro.email ?? "").trim().toLowerCase();
  const out: (EventoAcceso & { integro: boolean })[] = [];
  for (const linea of raw.split("\n")) {
    if (!linea.trim()) continue;
    try {
      const { firma, ...ev } = JSON.parse(linea) as EventoAcceso & { firma?: string };
      if (ruc && ev.ruc !== ruc) continue;
      if (email && !(ev.email ?? "").toLowerCase().includes(email)) continue;
      const esperada = Buffer.from(firmar(JSON.stringify(ev)));
      const dada = Buffer.from(String(firma ?? ""));
      out.push({ ...ev, integro: dada.length === esperada.length && timingSafeEqual(dada, esperada) });
    } catch { /* línea dañada: se omite */ }
  }
  return out;
}

// ---- Anotación por petición (desde getCurrentUser) -------------------------
// Qué se anota: toda página que se abre (no las precargas del navegador), toda
// operación que modifica (POST/PUT/PATCH/DELETE) y las lecturas de la API sobre
// una empresa o que descargan información. Una sola vez por petición (x-req-id).
const LECTURA_SENSIBLE = /\/clientes\/|export|backup|descarg|excel|xml|pdf|zip|informe|accesos/i;
const NO_SON_EMPRESA = new Set(["export", "importar", "verificar", "nuevo"]);
const gv = globalThis as unknown as { __radarAnotadas?: Map<string, number> };
const anotadas: Map<string, number> = gv.__radarAnotadas ?? (gv.__radarAnotadas = new Map());

export function anotarPeticion(uid: string, h: Headers): void {
  try {
    const id = h.get("x-req-id");
    const ruta = h.get("x-pathname") || "";
    if (!id || !ruta || anotadas.has(id)) return;
    const ahora = Date.now();
    anotadas.set(id, ahora);
    if (anotadas.size > 3000) for (const [k, t] of Array.from(anotadas.entries())) if (t < ahora - 120_000) anotadas.delete(k);
    const metodo = (h.get("x-metodo") || "GET").toUpperCase();
    const esApi = ruta.startsWith("/api/");
    if (metodo === "HEAD" || metodo === "OPTIONS") return;
    if (h.get("next-router-prefetch") || h.get("purpose") === "prefetch") return;
    if (esApi && metodo === "GET" && !LECTURA_SENSIBLE.test(ruta)) return;
    const seg = ruta.match(/\/clientes\/([A-Za-z0-9_-]+)/)?.[1];
    const ruc = (new URLSearchParams(h.get("x-query") || "").get("ruc") || "").replace(/\D/g, "");
    void registrarAcceso({
      ev: esApi ? "api" : "pagina",
      uid,
      ip: (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "local").trim(),
      ua: h.get("user-agent") ?? undefined,
      metodo,
      ruta,
      clienteId: seg && !NO_SON_EMPRESA.has(seg) ? seg : undefined,
      ruc: ruc.length === 11 ? ruc : undefined,
    });
  } catch { /* el registro nunca rompe la petición */ }
}
