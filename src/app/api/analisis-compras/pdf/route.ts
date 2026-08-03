import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { lanzarNavegador } from "@/lib/navegador";
import { informeComprasHtml } from "@/lib/analisisComprasHtml";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST JSON { analisis } → PDF del informe de compras/gastos (informe normal,
// SIN logo/marca). Se arma un HTML autocontenido y se renderiza con el
// navegador headless, sin encabezado/pie del navegador.
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => null);
  const analisis = body?.analisis;
  if (!analisis || typeof analisis !== "object") {
    return NextResponse.json({ error: "Falta el análisis." }, { status: 400 });
  }

  let browser: any;
  try {
    const html = informeComprasHtml(analisis);
    browser = await lanzarNavegador();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "networkidle", timeout: 60000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: false, // sin fecha/hora/URL/número de página
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    await ctx.close();

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="informe-compras-gerencia.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[analisis-compras/pdf]", e);
    return NextResponse.json({ error: "No se pudo generar el PDF." }, { status: 500 });
  } finally {
    try { await browser?.close(); } catch {}
  }
}
