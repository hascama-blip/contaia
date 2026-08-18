import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { unzipSync } from "fflate";
import { parseLibroVentas, parseCajaVirtual, conciliarVentasCaja, excelVentasCaja, type VentaRow } from "@/lib/ventasCaja";
import { parseBancoStarsoft } from "@/lib/conciliacionStarsoft";

export const runtime = "nodejs";
export const maxDuration = 180;

const MAX_SIZE = 40 * 1024 * 1024; // 40 MB
const esExcel = (n: string) => /\.xlsx?$/i.test(n);

// Conciliación Libro de Ventas vs Caja Virtual. Multipart:
//   - ventas: uno o varios Excel (uno por mes) y/o un .zip con esos Excel.
//   - caja:   el Excel de la Caja Virtual (un solo archivo, todo el periodo).
// Devuelve el resumen + el Excel (base64). No persiste nada.
export async function POST(req: NextRequest) {
  await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido." }, { status: 400 });

  const ventasFiles = form.getAll("ventas").filter((v): v is File => v instanceof File && v.size > 0);
  const cajaF = form.get("caja");
  const fCaja = cajaF instanceof File && cajaF.size > 0 ? cajaF : null;
  const bancoFiles = form.getAll("banco").filter((v): v is File => v instanceof File && v.size > 0); // opcional, varios

  if (!ventasFiles.length) return NextResponse.json({ error: "Adjunta el/los Libro(s) de Ventas (Excel o ZIP)." }, { status: 400 });
  if (!fCaja) return NextResponse.json({ error: "Adjunta el Excel de la Caja Virtual." }, { status: 400 });
  for (const f of [...ventasFiles, fCaja, ...bancoFiles]) {
    if (f.size > MAX_SIZE) return NextResponse.json({ error: `"${f.name}" supera 40 MB.` }, { status: 400 });
  }

  try {
    // Reúne todos los Excel de ventas (extrayendo los que vengan en ZIP).
    const excelVentas: { nombre: string; buf: Buffer }[] = [];
    for (const f of ventasFiles) {
      const buf = Buffer.from(await f.arrayBuffer());
      if (/\.zip$/i.test(f.name)) {
        const zip = unzipSync(new Uint8Array(buf));
        for (const [nombre, data] of Object.entries(zip)) {
          if (esExcel(nombre) && !nombre.startsWith("__MACOSX")) excelVentas.push({ nombre, buf: Buffer.from(data) });
        }
      } else if (esExcel(f.name)) {
        excelVentas.push({ nombre: f.name, buf });
      }
    }
    if (!excelVentas.length) return NextResponse.json({ error: "No se encontraron Excel de ventas (ni sueltos ni dentro del ZIP)." }, { status: 422 });

    const ventas: VentaRow[] = [];
    const detalle: { archivo: string; filas: number; periodo: string }[] = [];
    for (const e of excelVentas) {
      const rows = parseLibroVentas(e.buf);
      ventas.push(...rows);
      detalle.push({ archivo: e.nombre, filas: rows.length, periodo: rows[0]?.mes || "?" });
    }
    if (!ventas.length) return NextResponse.json({ error: "Los Excel de ventas no tienen filas con Documento válido." }, { status: 422 });

    const caja = parseCajaVirtual(Buffer.from(await fCaja.arrayBuffer()));
    if (!caja.length) return NextResponse.json({ error: "La Caja Virtual no tiene comprobantes legibles." }, { status: 422 });

    // Banco (opcional, varios archivos): suma de ABONOS (ingresos) por mes.
    // Solo las hojas (cuentas) elegidas de la empresa; si no se eligen, todas.
    let bancoAbonoPorMes: Record<string, number> | undefined;
    if (bancoFiles.length) {
      const hojas = form.getAll("bancoHoja").map((v) => String(v).trim()).filter(Boolean);
      bancoAbonoPorMes = {};
      for (const bf of bancoFiles) {
        const movs = parseBancoStarsoft(Buffer.from(await bf.arrayBuffer()), hojas.length ? hojas : undefined);
        for (const m of movs) {
          const ym = (m.fecha || "").slice(0, 7);
          if (/^\d{4}-\d{2}$/.test(ym) && m.abono) bancoAbonoPorMes[ym] = (bancoAbonoPorMes[ym] ?? 0) + m.abono;
        }
      }
    }

    const r = conciliarVentasCaja(ventas, caja, bancoAbonoPorMes);
    const excel = await excelVentasCaja(r);
    return NextResponse.json({
      ok: true,
      detalle,
      resumen: r.resumen,
      excel: excel.toString("base64"),
      nombre: "Conciliacion_Ventas_vs_Caja.xlsx",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error procesando la conciliación." }, { status: 500 });
  }
}
