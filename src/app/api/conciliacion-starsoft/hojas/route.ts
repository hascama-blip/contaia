import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listarHojasBanco, agruparHojasPorEmpresa, EmpresaBanco } from "@/lib/conciliacionStarsoft";

export const runtime = "nodejs";

// Devuelve los nombres de las hojas (cuentas) del FORMATO BANCO STARSOFT subido,
// para que el usuario elija con cuál conciliar.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("banco") ?? []).filter((v): v is File => v instanceof File && v.size > 0);
  if (!files.length) {
    return NextResponse.json({ error: "Adjunta el/los Excel del banco." }, { status: 400 });
  }
  try {
    // Unión de las hojas (cuentas) y su AGRUPACIÓN POR EMPRESA (según la leyenda /
    // el nombre de empresa en cada hoja), preservando el orden.
    const vistas = new Set<string>();
    const hojas: string[] = [];
    const empresas: EmpresaBanco[] = [];
    const idxEmpresa: Record<string, number> = {};
    for (const f of files) {
      const buf = Buffer.from(await f.arrayBuffer());
      for (const h of listarHojasBanco(buf)) {
        if (!vistas.has(h)) { vistas.add(h); hojas.push(h); }
      }
      for (const g of agruparHojasPorEmpresa(buf)) {
        const key = g.empresa.toUpperCase().replace(/\s+/g, " ").trim();
        if (idxEmpresa[key] === undefined) { idxEmpresa[key] = empresas.length; empresas.push({ empresa: g.empresa, cuentas: [] }); }
        for (const c of g.cuentas) if (!empresas[idxEmpresa[key]].cuentas.includes(c)) empresas[idxEmpresa[key]].cuentas.push(c);
      }
    }
    return NextResponse.json({ hojas, empresas });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo leer el Excel." }, { status: 500 });
  }
}
