import { NextRequest, NextResponse } from "next/server";
import { bloqueoModulo } from "@/lib/acceso";
import { getClienteAutorizado } from "@/lib/auth";
import { lanzarNavegador } from "@/lib/navegador";
import { hoyLima } from "@/lib/fechas";
import { armarProyeccion, limpiarEntradas } from "@/lib/proyeccion";
import { informeProyeccionHtml } from "@/lib/proyeccionHtml";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST { cliente, periodo, base, ...datos manuales } → informe PDF de la proyección
// (se recalcula en el servidor con el SIRE y el detalle guardados).
export async function POST(req: NextRequest) {
  const _b = await bloqueoModulo("proyeccion"); if (_b) return _b;
  const body = await req.json().catch(() => ({}));
  const cliente = await getClienteAutorizado(String(body?.cliente ?? ""));
  if (!cliente) return NextResponse.json({ error: "Empresa no encontrada." }, { status: 404 });
  const periodo = String(body?.periodo ?? "");
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) return NextResponse.json({ error: "Periodo inválido (AAAAMM)." }, { status: 400 });
  const hoy = hoyLima();
  const p = armarProyeccion(cliente, periodo, hoy, {
    entradas: limpiarEntradas(body),
    base: body?.base === "detalle" ? "detalle" : body?.base === "resumen" ? "resumen" : null,
  });
  if (!p.resultado) return NextResponse.json({ error: "Falta el SIRE del periodo: genéralo primero en el Reporte analítico o en Detalle SIRE." }, { status: 400 });

  let browser: any;
  try {
    browser = await lanzarNavegador();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent(informeProyeccionHtml(p, hoy), { waitUntil: "networkidle", timeout: 60000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, displayHeaderFooter: false, margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
    await ctx.close();
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="proyeccion-tributaria-${cliente.ruc}-${periodo}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[proyeccion/pdf]", e);
    return NextResponse.json({ error: "No se pudo generar el PDF." }, { status: 500 });
  } finally {
    try { await browser?.close(); } catch {}
  }
}
