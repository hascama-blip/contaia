import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseLibroDiarioHojas, analizarCompras, analizarGrupo, claveEmpresa, type MovDiario } from "@/lib/analisisCompras";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST (multipart) file(s) = Libro(s) Diario(s) en Excel.
//  · Varios archivos de la MISMA empresa (enero…diciembre) → un análisis combinado.
//  · Un Excel con una PESTAÑA POR EMPRESA (p. ej. "EGRESOS EMPRESAS OCT") o
//    archivos de empresas distintas → un análisis por empresa + el consolidado
//    del grupo con el comparativo entre empresas.
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("analisis-rtp"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const form = await req.formData().catch(() => null);
  const files = form ? (form.getAll("file").filter((f) => f instanceof File) as File[]) : [];
  if (!files.length) {
    return NextResponse.json({ error: "Sube al menos un Libro Diario en Excel." }, { status: 400 });
  }

  try {
    // Agrupa las pestañas por empresa (la de la celda A1 de cada pestaña).
    const grupos = new Map<string, { empresa: string; hoja: string; movimientos: MovDiario[]; asientos: number }>();
    const archivos: { nombre: string; hoja?: string; empresa: string; movimientos: number; asientos: number }[] = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const hojas = await parseLibroDiarioHojas(buf);
      for (const h of hojas) {
        const k = claveEmpresa(h.empresa) || h.hoja;
        const g = grupos.get(k) ?? grupos.set(k, { empresa: h.empresa, hoja: h.hoja, movimientos: [], asientos: 0 }).get(k)!;
        g.movimientos.push(...h.movimientos);
        g.asientos += h.asientos;
        archivos.push({ nombre: file.name, hoja: hojas.length > 1 ? h.hoja : undefined, empresa: h.empresa, movimientos: h.movimientos.length, asientos: h.asientos });
      }
    }
    if (!grupos.size) {
      return NextResponse.json({ error: "No se reconocieron movimientos. Verifica que sean Libros Diarios (columnas Cuenta, Debe, Haber…)." }, { status: 422 });
    }

    if (grupos.size === 1) {
      const g = [...grupos.values()][0];
      const analisis = analizarCompras(g.movimientos, g.empresa, g.asientos);
      if (analisis.totalGasto <= 0) {
        return NextResponse.json({ error: "No se hallaron cuentas de clase 9 (gastos por función). ¿Los Libros incluyen la contabilidad analítica?" }, { status: 422 });
      }
      return NextResponse.json({ analisis, archivos });
    }

    // Varias empresas: las que no tienen clase 9 se informan pero no se analizan.
    const conGasto = [...grupos.values()].filter((g) => g.movimientos.some((m) => m.cuenta.startsWith("9") && m.debe > 0));
    const sinGasto = [...grupos.values()].filter((g) => !conGasto.includes(g)).map((g) => g.empresa);
    if (!conGasto.length) {
      return NextResponse.json({ error: "Ninguna pestaña tiene cuentas de clase 9 (gastos por función). ¿Los Libros incluyen la contabilidad analítica?" }, { status: 422 });
    }
    if (conGasto.length === 1) {
      const g = conGasto[0];
      return NextResponse.json({ analisis: analizarCompras(g.movimientos, g.empresa, g.asientos), archivos, sinGasto });
    }
    const { consolidado, empresas } = analizarGrupo(conGasto);
    return NextResponse.json({ analisis: consolidado, empresas, archivos, sinGasto });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo leer el archivo." }, { status: 500 });
  }
}
