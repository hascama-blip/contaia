import { NextRequest, NextResponse } from "next/server";
import { consultarDni, dniValido, ErrorReniec, reniecReal } from "@/lib/reniec";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/authToken";

export const runtime = "nodejs";

// Consulta de DNI (RENIEC vía apidni.com). La usan:
//   - Radar (alta de clientes / representantes), con la sesión normal.
//   - El portal del C.C. Inmaculada Concepción (página aparte, en otro
//     dominio): sin sesión, se identifica con la cabecera `x-api-key`
//     (RENIEC_API_KEY) y su origen debe estar en RENIEC_CORS_ORIGENES.
// El token de apidni nunca sale del servidor.

const LIMITE_POR_MINUTO = Number(process.env.RENIEC_LIMITE_MINUTO ?? 30);
const ventanas = new Map<string, { hasta: number; n: number }>();

function excedeLimite(clave: string): boolean {
  const ahora = Date.now();
  const v = ventanas.get(clave);
  if (!v || v.hasta < ahora) {
    ventanas.set(clave, { hasta: ahora + 60_000, n: 1 });
    if (ventanas.size > 5000) for (const [k, w] of ventanas) if (w.hasta < ahora) ventanas.delete(k);
    return false;
  }
  v.n += 1;
  return v.n > LIMITE_POR_MINUTO;
}

function origenPermitido(origen: string | null): string | null {
  if (!origen) return null;
  const lista = (process.env.RENIEC_CORS_ORIGENES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (lista.includes("*") || lista.includes(origen)) return origen;
  // Un archivo HTML abierto con doble clic manda Origin "null".
  if (origen === "null" && lista.includes("null")) return "null";
  return null;
}

function conCors(res: NextResponse, origen: string | null): NextResponse {
  if (origen) {
    res.headers.set("Access-Control-Allow-Origin", origen);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Headers", "x-api-key, content-type");
    res.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  }
  return res;
}

export async function OPTIONS(req: NextRequest) {
  return conCors(new NextResponse(null, { status: 204 }), origenPermitido(req.headers.get("origin")));
}

async function autorizado(req: NextRequest): Promise<boolean> {
  const clave = process.env.RENIEC_API_KEY ?? "";
  if (clave && req.headers.get("x-api-key") === clave) return true;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return Boolean(token && (await verifySessionToken(token)));
}

export async function GET(req: NextRequest, { params }: { params: { dni: string } }) {
  const origen = origenPermitido(req.headers.get("origin"));
  const responder = (cuerpo: unknown, status = 200) => conCors(NextResponse.json(cuerpo, { status }), origen);

  if (!(await autorizado(req))) return responder({ error: "No autenticado" }, 401);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.ip || "desconocida";
  if (excedeLimite(ip)) return responder({ error: "Demasiadas consultas seguidas. Espera un minuto." }, 429);

  const dni = (params.dni ?? "").trim();
  if (!dniValido(dni)) return responder({ error: "El DNI debe tener 8 dígitos numéricos." }, 400);

  try {
    // ?forzar=1 vuelve a consultar aunque esté en caché (p. ej. cambió el plan y ahora trae foto).
    const persona = await consultarDni(dni, { forzar: req.nextUrl.searchParams.get("forzar") === "1" });
    return responder({ persona, simulado: !reniecReal() });
  } catch (err: any) {
    if (err instanceof ErrorReniec) return responder({ error: err.message }, err.status);
    return responder({ error: err?.message ?? "Error consultando RENIEC" }, 502);
  }
}
