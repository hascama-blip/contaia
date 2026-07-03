import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser, studioId } from "@/lib/auth";
import { getClienteDeUsuario } from "@/lib/db";
import { lanzarNavegador } from "@/lib/navegador";
import { SESSION_COOKIE } from "@/lib/authToken";

export const runtime = "nodejs";
export const maxDuration = 120;

// Genera el informe en PDF con el navegador headless SIN encabezado/pie del
// navegador (fecha, hora, URL, número de página). Renderiza la MISMA página del
// informe autenticada con la cookie de sesión del usuario.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  const cliente = await getClienteDeUsuario(params.id, studioId(user));
  if (!cliente) return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });

  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "";
  const base = (process.env.APP_URL || `${proto}://${host}`).replace(/\/$/, "");
  const url = `${base}/clientes/${params.id}/informe`;

  let browser: any;
  try {
    const u = new URL(base);
    browser = await lanzarNavegador();
    const ctx = await browser.newContext();
    await ctx.addCookies([
      {
        name: SESSION_COOKIE,
        value: token,
        domain: u.hostname,
        path: "/",
        httpOnly: true,
        secure: u.protocol === "https:",
        sameSite: "Lax",
      },
    ]);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: false, // sin fecha/hora/URL/número de página
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    await ctx.close();

    const nombre = `informe-${(cliente.ruc || "cliente").replace(/[^\w.-]/g, "")}.pdf`;
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[informe/pdf]", e);
    return NextResponse.json(
      { error: "No se pudo generar el PDF. Usa el botón Imprimir." },
      { status: 500 }
    );
  } finally {
    try {
      await browser?.close();
    } catch {}
  }
}
