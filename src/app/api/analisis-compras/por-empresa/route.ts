import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { zipSync } from "fflate";
import { requireUser } from "@/lib/auth";
import { lanzarNavegador, contextoPdf } from "@/lib/navegador";
import { informeComprasHtml } from "@/lib/analisisComprasHtml";
import { informeComprasXlsx } from "@/lib/analisisComprasXlsx";
import type { AnalisisCompras } from "@/lib/analisisCompras";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST JSON { empresas: AnalisisCompras[], tipo: "pdf" | "excel" } → ZIP con
// UN informe por empresa (análisis dividido, no el consolidado). Un solo
// navegador para todos los PDF.
const slug = (s: string) =>
  String(s || "empresa").replace(/\./g, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "empresa";

export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("analisis-rtp"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const body = await req.json().catch(() => null);
  const tipo = body?.tipo === "excel" ? "excel" : "pdf";
  const empresas: AnalisisCompras[] = Array.isArray(body?.empresas)
    ? body.empresas.filter((a: any) => a && typeof a === "object" && Array.isArray(a.porFuncion)).slice(0, 40)
    : [];
  if (!empresas.length) return NextResponse.json({ error: "No hay empresas para descargar." }, { status: 400 });

  const archivos: Record<string, Uint8Array> = {};
  const nombre = (a: AnalisisCompras, i: number, ext: string) => {
    const base = `${String(i + 1).padStart(2, "0")}-${slug(a.empresa)}${a.periodo ? `-${slug(a.periodo)}` : ""}`;
    return `${base}.${ext}`;
  };

  if (tipo === "excel") {
    for (const [i, a] of empresas.entries()) archivos[nombre(a, i, "xlsx")] = new Uint8Array(await informeComprasXlsx(a));
  } else {
    let browser: any;
    try {
      browser = await lanzarNavegador();
      const ctx = await contextoPdf(browser); // sin JS ni red
      for (const [i, a] of empresas.entries()) {
        const page = await ctx.newPage();
        await page.setContent(informeComprasHtml(a), { waitUntil: "networkidle", timeout: 60000 });
        const pdf = await page.pdf({
          format: "A4", printBackground: true, displayHeaderFooter: false,
          margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
        });
        await page.close();
        archivos[nombre(a, i, "pdf")] = new Uint8Array(pdf);
      }
      await ctx.close();
    } catch (e) {
      console.error("[analisis-compras/por-empresa]", e);
      return NextResponse.json({ error: "No se pudieron generar los PDF." }, { status: 500 });
    } finally {
      try { await browser?.close(); } catch {}
    }
  }

  const periodo = slug(empresas[0]?.periodo || "");
  const zip = zipSync(archivos, { level: 6 });
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="informes-compras-por-empresa${periodo ? `-${periodo}` : ""}-${tipo}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
