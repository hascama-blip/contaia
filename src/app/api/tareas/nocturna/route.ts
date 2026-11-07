import { NextRequest, NextResponse } from "next/server";
import { esSupremo, getCurrentUser } from "@/lib/auth";
import { ejecutarNocturna } from "@/lib/nocturna";
import { getEstadoAlertas } from "@/lib/db";
import { tokenInterno } from "@/lib/tokenInterno";

export const runtime = "nodejs";
export const maxDuration = 800;

// Tarea nocturna de alertas. La dispara el planificador interno (token interno);
// también puede llamarla un cron externo con ?token=CRON_SECRET, o el supremo
// desde su sesión (GET = estado, POST = ejecutar; ?forzar=1 repite aunque ya
// haya corrido hoy).
async function autorizado(req: NextRequest): Promise<boolean> {
  const token = req.nextUrl.searchParams.get("token") || req.headers.get("x-cron-token") || "";
  const igual = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  if (token) {
    if (process.env.CRON_SECRET && igual(token, process.env.CRON_SECRET)) return true;
    if (igual(token, await tokenInterno())) return true;
  }
  return esSupremo(await getCurrentUser());
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const e = await getEstadoAlertas();
  return NextResponse.json({ ultimaNocturna: e.ultimaNocturna ?? null, ultimaNocturnaAt: e.ultimaNocturnaAt ?? null, resumen: e.ultimaNocturnaResumen ?? null });
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const forzar = req.nextUrl.searchParams.get("forzar") === "1";
  const res = await ejecutarNocturna({ forzar });
  return NextResponse.json(res);
}
