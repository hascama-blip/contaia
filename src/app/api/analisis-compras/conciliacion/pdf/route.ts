import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { lanzarNavegador } from "@/lib/navegador";
import { informeConciliacionHtml } from "@/lib/conciliacionHtml";
import { hoyLima } from "@/lib/fechas";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST JSON { empresas, cierre, hoy } (resultado de /conciliacion) → PDF SOLO RESUMEN
// (análisis de cierre + resumen por empresa; el detalle va en el Excel).
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("analisis-rtp"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const body = await req.json().catch(() => null);
  const empresas = Array.isArray(body?.empresas) ? body.empresas.filter((e: any) => e?.cruce?.totalesSire).slice(0, 40) : [];
  if (!empresas.length) return NextResponse.json({ error: "No hay conciliación para el informe." }, { status: 400 });
  const cierre = Array.isArray(body?.cierre) ? body.cierre.slice(0, 40) : [];
  const hoy = /^\d{4}-\d{2}-\d{2}$/.test(String(body?.hoy)) ? String(body.hoy) : hoyLima();

  let browser: any;
  try {
    browser = await lanzarNavegador();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(informeConciliacionHtml(empresas, cierre, hoy), { waitUntil: "networkidle", timeout: 60000 });
    const pdf = await page.pdf({ format: "A4", landscape: true, printBackground: true, displayHeaderFooter: false, margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
    await ctx.close();
    const per = String(empresas[0]?.periodo || "").replace(/\D/g, "");
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="conciliacion-sire-resumen${per ? `-${per}` : ""}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[conciliacion/pdf]", e);
    return NextResponse.json({ error: "No se pudo generar el PDF." }, { status: 500 });
  } finally {
    try { await browser?.close(); } catch {}
  }
}
