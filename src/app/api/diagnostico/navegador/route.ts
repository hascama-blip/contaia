import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";
import { lanzarNavegador } from "@/lib/navegador";

export const runtime = "nodejs";
export const maxDuration = 120;

// Prueba de "multiuso": abre N navegadores EN SIMULTÁNEO (cada uno una sesión
// aparte). Sirve para verificar que Browserless (o el Chromium local) aguanta la
// concurrencia. Solo el supremo puede ejecutarla (consume unidades/recursos).
//   GET /api/diagnostico/navegador?n=5
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!esSupremo(user)) {
    return NextResponse.json({ error: "Solo el usuario supremo puede ejecutar esta prueba." }, { status: 403 });
  }

  const nParam = Number(new URL(req.url).searchParams.get("n") ?? "3");
  const n = Math.max(1, Math.min(8, Number.isFinite(nParam) ? nParam : 3));
  const remoto = Boolean(process.env.BROWSER_WS_URL);

  const t0 = Date.now();
  // Cada tarea abre su propio navegador, mantiene la sesión ~1.2 s (para que las
  // N se solapen de verdad) y cierra. Se corren todas a la vez.
  const tareas = Array.from({ length: n }, (_, i) => probarUno(i));
  const detalles = await Promise.all(tareas);
  const ms = Date.now() - t0;

  const exitosas = detalles.filter((d) => d.ok).length;
  const fallidas = n - exitosas;

  return NextResponse.json({
    remoto,
    destino: remoto ? "Browserless (remoto)" : "Chromium local",
    solicitadas: n,
    exitosas,
    fallidas,
    concurrenciaOk: fallidas === 0,
    msTotal: ms,
    detalles,
  });
}

async function probarUno(i: number): Promise<{ i: number; ok: boolean; ms: number; error?: string }> {
  const t = Date.now();
  let browser: any;
  try {
    browser = await lanzarNavegador();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("about:blank", { timeout: 30000 });
    await page.setContent(`<title>prueba-${i}</title><h1>ok ${i}</h1>`);
    // Mantiene la sesión viva un momento para que las N se solapen.
    await page.waitForTimeout(1200);
    const title = await page.title();
    await ctx.close();
    return { i, ok: title === `prueba-${i}`, ms: Date.now() - t };
  } catch (e: any) {
    return { i, ok: false, ms: Date.now() - t, error: String(e?.message ?? e).slice(0, 200) };
  } finally {
    try {
      await browser?.close();
    } catch {}
  }
}
