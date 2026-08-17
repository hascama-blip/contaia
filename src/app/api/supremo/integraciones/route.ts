import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";
import { getIntegraciones, setIntegraciones } from "@/lib/db";

export const runtime = "nodejs";

// Oculta un secreto: deja ver solo los últimos 4 caracteres.
function mask(s: string): string {
  if (!s) return "";
  return s.length <= 4 ? "••••" : "•".repeat(Math.max(4, s.length - 4)) + s.slice(-4);
}

// Marca desde dónde viene el valor (entorno vs guardado en la app).
function fuente(env: string | undefined, valor: string): "entorno" | "app" | "—" {
  if ((env || "").trim()) return "entorno";
  return valor ? "app" : "—";
}

// GET  -> estado de las integraciones (sin exponer secretos completos).
export async function GET() {
  if (!esSupremo(await getCurrentUser())) {
    return NextResponse.json({ error: "Solo el supremo." }, { status: 403 });
  }
  const g = await getIntegraciones();
  return NextResponse.json({
    capsolver: {
      configurada: Boolean(g.capsolverKey),
      preview: mask(g.capsolverKey),
      fuente: fuente(process.env.CAPSOLVER_KEY, g.capsolverKey),
    },
    proxy: {
      configurado: Boolean(g.proxyServer),
      server: g.proxyServer, // el host no es secreto
      usuario: g.proxyUser ? mask(g.proxyUser) : "",
      tienePass: Boolean(g.proxyPass),
      fuente: fuente(process.env.PROXY_SERVER, g.proxyServer),
    },
  });
}

// POST -> guarda las integraciones. Solo se actualiza lo que venga en el body.
// Envía "" en un campo para borrarlo. Los campos que no vengan no se tocan.
export async function POST(req: NextRequest) {
  if (!esSupremo(await getCurrentUser())) {
    return NextResponse.json({ error: "Solo el supremo." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, string> = {};
  if (typeof b?.capsolverKey === "string") patch.capsolverKey = b.capsolverKey;
  if (typeof b?.proxyServer === "string") patch.proxyServer = b.proxyServer;
  if (typeof b?.proxyUser === "string") patch.proxyUser = b.proxyUser;
  if (typeof b?.proxyPass === "string") patch.proxyPass = b.proxyPass;

  if (patch.proxyServer && !/^(https?|socks5):\/\//i.test(patch.proxyServer)) {
    return NextResponse.json(
      { error: "El proxy debe empezar con http://, https:// o socks5://" },
      { status: 400 }
    );
  }
  await setIntegraciones(patch);
  return NextResponse.json({ ok: true });
}
