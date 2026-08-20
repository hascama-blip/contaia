import { NextRequest, NextResponse } from "next/server";
import { visorUserByToken, addVisorCaptura } from "@/lib/db";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

// Recibe una captura de la extensión (autenticada por token, no por cookie).
// Clasifica de forma ligera por la URL/contenido para el reporte.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const userId = await visorUserByToken(String(b?.token ?? ""));
  if (!userId) return NextResponse.json({ error: "Token inválido." }, { status: 401, headers: CORS });

  const url = String(b?.url ?? "").slice(0, 500);
  const titulo = String(b?.titulo ?? "").slice(0, 300);
  const texto = String(b?.texto ?? "").slice(0, 20000);
  const datos = b?.datos ?? null;

  // Clasificación. Preferimos los datos ESTRUCTURADOS (escaneo del DOM del SIRE).
  let tipo = "otro";
  let resumen = "";
  const sire = Array.isArray(datos?.sire) ? datos.sire as { periodo: string; estado: string }[] : null;
  if (sire && sire.length) {
    tipo = "sire";
    const noPres = sire.filter((p) => /no/i.test(p.estado));
    resumen = noPres.length
      ? `SIRE: ${noPres.length} NO presentado (${noPres.map((p) => p.periodo).join(", ")})`
      : `SIRE: ${sire.length} periodo(s), todos presentados`;
  } else {
    const t = (url + " " + titulo + " " + texto).toLowerCase();
    if (/sire|rvie|rce|migeigv|propuesta|no presentad|presentad/.test(t)) tipo = "sire";
    else if (/renta anual|dj anual|formulario 710|declaraci[oó]n anual/.test(t)) tipo = "dj-anual";
    else if (/declaraci[oó]n.*mensual|formulario 621|pdt 621|mensual|omiso/.test(t)) tipo = "dj-mensual";
    if (tipo === "sire") resumen = /no\s*present/.test(t) ? "SIRE: hay periodos NO presentados" : "SIRE: revisado";
    else if (tipo === "dj-mensual") resumen = /omiso|no\s*present|sin\s*declaraci/.test(t) ? "DJ mensual: meses sin declarar" : "DJ mensual: revisado";
    else if (tipo === "dj-anual") resumen = /no\s*present|sin\s*present|no\s*existe/.test(t) ? "DJ anual: no presentada" : "DJ anual: revisada";
    // Ruido común: descartar llamadas de sincronización de hora, etc.
    if (tipo === "otro" && /gettime|\/time\/|favicon|\.css|\.js(\?|$)/i.test(url)) {
      return NextResponse.json({ ok: true, ignorado: true }, { headers: CORS });
    }
  }

  const cap = await addVisorCaptura({ userId, url, titulo, tipo, resumen, texto, datos });
  return NextResponse.json({ ok: true, id: cap.id, tipo, resumen }, { headers: CORS });
}
