import { NextRequest, NextResponse } from "next/server";
import { visorUserByToken, addVisorCaptura, upsertVisorMatriz } from "@/lib/db";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
export async function OPTIONS() { return new NextResponse(null, { headers: CORS }); }

const MESES: Record<string, string> = {
  ENE: "01", FEB: "02", MAR: "03", ABR: "04", MAY: "05", JUN: "06",
  JUL: "07", AGO: "08", SEP: "09", SET: "09", OCT: "10", NOV: "11", DIC: "12",
};
const NOM_MES = ["", "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const est = (s: string): "P" | "NP" => (/no/i.test(s) ? "NP" : "P");

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const userId = await visorUserByToken(String(b?.token ?? ""));
  if (!userId) return NextResponse.json({ error: "Token inválido." }, { status: 401, headers: CORS });

  const url = String(b?.url ?? "").slice(0, 500);
  const titulo = String(b?.titulo ?? "").slice(0, 300);
  const texto = String(b?.texto ?? "").slice(0, 20000);
  const datos = b?.datos ?? null;
  const v = datos?.visor; // payload estructurado de la extensión

  // Payload estructurado → matriz (cuadro año×mes).
  if (v && (v.celdas || Array.isArray(v.meses) || Array.isArray(v.anios))) {
    const celdas: Record<string, "P" | "NP"> = {};
    // celdas ya en formato "YYYY-MM" (DJ mensual y SIRE nuevo).
    if (v.celdas && typeof v.celdas === "object") {
      for (const [k, e] of Object.entries(v.celdas)) if (/^\d{4}-\d{2}$/.test(k)) celdas[k] = est(String(e));
    }
    // compat: meses[] + año seleccionado (SIRE viejo).
    const anioSel = String(v.anio || "").match(/20\d{2}/)?.[0] || "";
    for (const it of (v.meses || [])) {
      const mm = MESES[String(it.mes || "").toUpperCase()] || (String(it.mes).match(/^\d{2}$/) ? String(it.mes) : "");
      if (mm && anioSel) celdas[`${anioSel}-${mm}`] = est(String(it.estado));
    }
    const anios: Record<string, "P" | "NP"> = {};
    if (v.anios && !Array.isArray(v.anios) && typeof v.anios === "object") {
      for (const [y, e] of Object.entries(v.anios)) if (/^20\d{2}$/.test(y)) anios[y] = est(String(e));
    }
    for (const it of (Array.isArray(v.anios) ? v.anios : [])) {
      const yy = String(it.anio || "").match(/20\d{2}/)?.[0];
      if (yy) anios[yy] = est(String(it.estado));
    }
    const m = await upsertVisorMatriz(userId, { empresa: v.empresa, ruc: v.ruc, tipo: v.tipo || "sire", celdas, anios });
    const np = Object.entries(m.celdas).filter(([, e]) => e === "NP").map(([k]) => k).sort();
    const resumen = np.length ? `${m.tipo.toUpperCase()}: ${np.length} No Presentó` : `${m.tipo.toUpperCase()}: al día`;
    await addVisorCaptura({ userId, url, titulo, tipo: m.tipo, resumen, texto: "", datos: null });
    return NextResponse.json({ ok: true, resumen }, { headers: CORS });
  }

  // Descartar ruido evidente.
  if (/gettime|\/time\/|favicon|\.css|\.js(\?|$)/i.test(url)) {
    return NextResponse.json({ ok: true, ignorado: true }, { headers: CORS });
  }

  // Fallback: clasificación ligera por texto.
  const t = (url + " " + titulo + " " + texto).toLowerCase();
  let tipo = "otro";
  if (/sire|rvie|rce|migeigv|propuesta|no presentad|presentad/.test(t)) tipo = "sire";
  else if (/renta anual|dj anual|formulario 710/.test(t)) tipo = "dj-anual";
  else if (/declaraci[oó]n.*mensual|formulario 621|pdt 621|omiso/.test(t)) tipo = "dj-mensual";
  const cap = await addVisorCaptura({ userId, url, titulo, tipo, resumen: "", texto, datos });
  return NextResponse.json({ ok: true, id: cap.id, tipo }, { headers: CORS });
}
