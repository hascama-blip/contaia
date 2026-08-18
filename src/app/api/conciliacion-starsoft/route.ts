import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  detectarTipoSistema, parseBancoStarsoft, parseStandardBancos, parseVentas, parseAnexos,
  conciliar, excelConciliacionStarsoft,
} from "@/lib/conciliacionStarsoft";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 30 * 1024 * 1024; // 30 MB (los .xls del SIRE pesan)

// Conciliación bancaria StarSoft: POST multipart con
//   - sistema (1 a 3 Excel: S_movStandard [obligatorio], V_movVentas, trama_anexos)
//   - banco   (Excel FORMATO BANCO STARSOFT, obligatorio)
// Auto-detecta cuál de los 3 es cada uno por sus encabezados. Devuelve el resumen
// + el Excel conciliado (base64). No persiste nada.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido." }, { status: 400 });

  const sistema = form.getAll("sistema").filter((v): v is File => v instanceof File && v.size > 0);
  const banco = form.get("banco");
  const fBanco = banco instanceof File && banco.size > 0 ? banco : null;

  if (!sistema.length) return NextResponse.json({ error: "Adjunta los Excel del sistema (Standard, Ventas, Anexos)." }, { status: 400 });
  if (!fBanco) return NextResponse.json({ error: "Adjunta el Excel FORMATO BANCO STARSOFT." }, { status: 400 });
  for (const f of [...sistema, fBanco]) {
    if (f.size > MAX_SIZE) return NextResponse.json({ error: `"${f.name}" supera 30 MB.` }, { status: 400 });
  }

  try {
    // Clasificar los archivos del sistema por sus encabezados.
    let bufStd: Buffer | null = null, bufVentas: Buffer | null = null, bufAnexos: Buffer | null = null;
    const detectados: Record<string, string> = {};
    for (const f of sistema) {
      const buf = Buffer.from(await f.arrayBuffer());
      const tipo = detectarTipoSistema(buf);
      detectados[f.name] = tipo;
      if (tipo === "standard" && !bufStd) bufStd = buf;
      else if (tipo === "ventas" && !bufVentas) bufVentas = buf;
      else if (tipo === "anexos" && !bufAnexos) bufAnexos = buf;
    }
    if (!bufStd) {
      return NextResponse.json(
        { error: "No se encontró el Excel 'Standard' (S_movStandard, con CTA CONTABLE) entre los archivos del sistema.", detectados },
        { status: 422 }
      );
    }

    const hoja = typeof form.get("hoja") === "string" ? String(form.get("hoja")).trim() : "";
    const bufBanco = Buffer.from(await fBanco.arrayBuffer());
    const bancoMovs = parseBancoStarsoft(bufBanco, hoja || undefined);
    if (!bancoMovs.length) {
      return NextResponse.json({ error: `No se leyeron movimientos del banco${hoja ? ` en la hoja "${hoja}"` : ""}.` }, { status: 422 });
    }
    const std = parseStandardBancos(bufStd);
    if (!std.length) {
      return NextResponse.json({ error: "El Standard no tiene filas de cuentas de banco (104x)." }, { status: 422 });
    }
    const ventas = bufVentas ? parseVentas(bufVentas) : {};
    const anexos = bufAnexos ? parseAnexos(bufAnexos) : {};

    const r = conciliar(bancoMovs, std, ventas, anexos);
    const excel = await excelConciliacionStarsoft(r);

    return NextResponse.json({
      ok: true,
      detectados,
      resumen: r.resumen,
      hoja: hoja || "(todas)",
      excel: excel.toString("base64"),
      nombre: `Conciliacion_Banco_StarSoft${hoja ? "_" + hoja : ""}.xlsx`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error procesando la conciliación." }, { status: 500 });
  }
}
