import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { lanzarNavegador, bloquearRecursos } from "@/lib/navegador";
import { facturaHtml } from "@/lib/facturaPdfHtml";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST { factura } → PDF (representación impresa del comprobante) renderizado con
// el navegador headless (misma cola/patrón que el buzón). Un comprobante por
// llamada (el usuario pulsa el botón PDF de una fila).
export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const f = body?.factura;
  if (!f || (!f.serieNumero && !f.serie)) {
    return NextResponse.json({ error: "Falta el comprobante a imprimir." }, { status: 400 });
  }

  let browser: any = null;
  try {
    browser = await lanzarNavegador();
    const ctx = await browser.newContext();
    await bloquearRecursos(ctx);
    const page = await ctx.newPage();
    await page.setContent(facturaHtml(f), { waitUntil: "load", timeout: 30000 });
    const buf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
    });
    const nombre = String(f.serieNumero || `${f.serie}-${f.numero}`).replace(/[^\w.-]/g, "_");
    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nombre}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo generar el PDF." }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
