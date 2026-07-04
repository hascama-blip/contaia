import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";
import { conectarNavegador, estadoNavegadores } from "@/lib/navegador";
import { getBrowserWsUrl } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

// Prueba de "multiuso": abre N navegadores EN SIMULTÁNEO (cada uno una sesión
// aparte). Sirve para verificar que Browserless (o el Chromium local) aguanta la
// concurrencia. Solo el supremo puede ejecutarla (consume unidades/recursos).
//   GET  /api/diagnostico/navegador?n=5           -> usa la config del servidor
//   POST { ws, n }                                -> prueba una URL directa (aísla Browserless)
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!esSupremo(user)) {
    return NextResponse.json({ error: "Solo el usuario supremo puede ejecutar esta prueba." }, { status: 403 });
  }

  const nParam = Number(new URL(req.url).searchParams.get("n") ?? "3");
  const n = Math.max(1, Math.min(8, Number.isFinite(nParam) ? nParam : 3));
  const configurado = Boolean(process.env.BROWSER_WS_URL);

  const t0 = Date.now();
  const detalles = await Promise.all(Array.from({ length: n }, (_, i) => probarUno(i)));
  const ms = Date.now() - t0;

  const exitosas = detalles.filter((d) => d.ok).length;
  const corrioRemoto = detalles.some((d) => d.remoto);
  const fuente = detalles.find((d) => d.fuente)?.fuente; // "env" | "guardada"
  const errorRemoto = detalles.find((d) => d.errorRemoto)?.errorRemoto;
  const guardadaConfig = Boolean((await getBrowserWsUrl()).trim());

  const fuenteTxt =
    fuente === "guardada" ? "URL guardada en la app" : fuente === "env" ? "variable de entorno" : "—";

  const envDebug = {
    variableEntorno: (process.env.BROWSER_WS_URL ?? "").length > 0 ? "sí llegó" : "no llegó (Render no la inyecta)",
    urlGuardadaEnApp: guardadaConfig ? "sí (configurada en el panel)" : "no",
  };

  return NextResponse.json({
    destinoReal: corrioRemoto ? "Browserless (remoto) ✅" : "Chromium local ⚠️",
    fuente: fuenteTxt,
    envDebug,
    aviso: corrioRemoto
      ? `Conectado a Browserless correctamente (usando la ${fuenteTxt}).`
      : guardadaConfig || configurado
        ? `Hay una URL configurada pero NO se pudo conectar a Browserless (se usó el navegador local). Revisa la URL/token. Error: ${errorRemoto ?? "desconocido"}`
        : "No hay URL de Browserless (ni variable ni guardada): se usa el Chromium local del servidor.",
    solicitadas: n,
    exitosas,
    fallidas: n - exitosas,
    concurrenciaOk: exitosas === n,
    msTotal: ms,
    // Cola de navegadores locales (protección de RAM): cuántos corren y esperan.
    colaNavegadores: estadoNavegadores(),
    detalles,
  });
}

// Prueba una URL de Browserless PEGADA A MANO, sin depender de la variable de
// entorno. Sirve para saber si el problema es Browserless o es Render.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!esSupremo(user)) {
    return NextResponse.json({ error: "Solo el usuario supremo puede ejecutar esta prueba." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const ws = typeof body?.ws === "string" ? body.ws.trim() : "";
  if (!ws || !/^wss?:\/\//i.test(ws)) {
    return NextResponse.json({ error: "Pega una URL válida que empiece con wss://" }, { status: 400 });
  }
  const n = Math.max(1, Math.min(8, Number(body?.n) || 1));

  const t0 = Date.now();
  const detalles = await Promise.all(Array.from({ length: n }, (_, i) => probarUno(i, ws)));
  const ms = Date.now() - t0;

  const exitosas = detalles.filter((d) => d.ok).length;
  const conecto = detalles.some((d) => d.remoto);
  const primerError = detalles.find((d) => d.error)?.error;

  return NextResponse.json({
    destinoReal: conecto ? "Browserless (URL directa) ✅" : "No conectó ❌",
    aviso: conecto
      ? "La URL de Browserless funciona. Si la app dice 'no hay', el problema es que Render no está cargando la variable (no es Browserless)."
      : `No se pudo conectar a esa URL de Browserless. Error: ${primerError ?? "desconocido"}`,
    solicitadas: n,
    exitosas,
    fallidas: n - exitosas,
    concurrenciaOk: exitosas === n,
    msTotal: ms,
    detalles: detalles.map((d) => ({ i: d.i, ok: d.ok, ms: d.ms, error: d.error })),
  });
}

// wsOverride: si se pasa, conecta DIRECTO a esa URL (ignora la config del server).
async function probarUno(
  i: number,
  wsOverride?: string
): Promise<{ i: number; ok: boolean; remoto: boolean; fuente?: "env" | "guardada"; ms: number; error?: string; errorRemoto?: string }> {
  const t = Date.now();
  let browser: any;
  try {
    let remoto: boolean;
    let fuente: "env" | "guardada" | undefined;
    let errorRemoto: string | undefined;
    if (wsOverride) {
      const { chromium } = await import("playwright-core");
      browser = await chromium.connectOverCDP(wsOverride);
      remoto = true;
    } else {
      const con = await conectarNavegador();
      browser = con.browser;
      remoto = con.remoto;
      fuente = con.fuente;
      errorRemoto = con.errorRemoto;
    }
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("about:blank", { timeout: 30000 });
    await page.setContent(`<title>prueba-${i}</title><h1>ok ${i}</h1>`);
    await page.waitForTimeout(1200); // mantiene la sesión viva para que las N se solapen
    const title = await page.title();
    await ctx.close();
    return { i, ok: title === `prueba-${i}`, remoto, fuente, ms: Date.now() - t, errorRemoto };
  } catch (e: any) {
    return { i, ok: false, remoto: false, ms: Date.now() - t, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    try {
      await browser?.close();
    } catch {}
  }
}
