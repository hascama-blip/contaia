import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";
import { getBrowserWsUrl, setBrowserWsUrl } from "@/lib/db";

export const runtime = "nodejs";

// GET  -> devuelve si hay URL guardada (sin exponer el token completo).
// POST { ws } -> guarda la URL del navegador remoto (Browserless).
export async function GET() {
  const user = await getCurrentUser();
  if (!esSupremo(user)) {
    return NextResponse.json({ error: "Solo el supremo." }, { status: 403 });
  }
  const url = await getBrowserWsUrl();
  return NextResponse.json({ configurada: Boolean(url), preview: enmascarar(url) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!esSupremo(user)) {
    return NextResponse.json({ error: "Solo el supremo." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const ws = typeof body?.ws === "string" ? body.ws.trim() : "";
  if (ws && !/^wss?:\/\//i.test(ws)) {
    return NextResponse.json({ error: "La URL debe empezar con wss://" }, { status: 400 });
  }
  await setBrowserWsUrl(ws);
  return NextResponse.json({ ok: true, configurada: Boolean(ws), preview: enmascarar(ws) });
}

// Oculta el token: deja ver el host y solo el final del token.
function enmascarar(url: string): string {
  if (!url) return "";
  return url.replace(/(token=)([^&]+)/i, (_m, p1, tok) =>
    `${p1}${"•".repeat(Math.max(0, tok.length - 4))}${tok.slice(-4)}`
  );
}
