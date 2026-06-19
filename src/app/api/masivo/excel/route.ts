import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================
//  Masivo de COMPRAS en el formato de importación de Contasis
// ============================================================
// Replica la plantilla "Registro_compras" (2 filas de cabecera + datos desde
// la fila 3, con la columna A vacía). La cuenta clasificada va en `cctabase` y
// la descripción del XML en `cglosa`.

// Cabecera fila 1 (etiquetas) — solo algunas celdas con texto.
const FILA1: Record<number, string> = {
  2: "FECHA EMISION",
  4: "FACTURA, BOLETA, NOTA DE CREDITO O DEBITO",
  9: "SE MANTIENE",
  10: "SE MANTIENE",
  29: "TIPO DE CAMBIO",
  44: "SE MANTIENE",
  56: "SE MANTIENE",
};

// Cabecera fila 2 (códigos de campo Contasis), columnas 2..56.
const FILA2: string[] = [
  "ffechadoc D", "ffechaven D", "ccoddoc C(2)", "ccoddas C(3)", "cyeardas C(4)",
  "cserie C(20)", "cnumero C(20)", "ccodenti C(11)", "cdesenti C(100)", "ctipdoc C(1)",
  "ccodruc C(15)", "crazsoc C(100)", "ccodclas C(1)", "nbase1 N(15,2)", "nigv1 N(15,2)",
  "nbase2 N(15,2)", "nigv2 N(15,2)", "nbase3 N(15,2)", "nigv3 N(15,2)", "nina N(15,2)",
  "nisc N(15,2)", "nicbper N(15,2)", "nexo N(15,2)", "ntots N(15,2)", "cdocnodom C(20)",
  "cnumdere C(15)", "ffecre D", "ntc N(10,6)", "freffec D", "crefdoc C(2)",
  "crefser C(6)", "crefnum C(13)", "cmreg C(1)", "ndolar N(15,2)", "ffechaven2 D",
  "ccond C(3)", "cctabase C(10)", "cctaicbper C(10)", "cctaotrib C(10)", "cctatot C(10)",
  "ccodcos C(9)", "ccodcos2 C(9)", "nresp N(1)", "nporre N(5,2)", "nimpres N(15,2)",
  "cserre C(6)", "cnumre C(13)", "ffecre2 D", "ccodpresu C(10)", "nigv N(5,2)",
  "cglosa C(50)", "nperdenre N(1)", "nbaseres N(15,2)", "cigvxacre C(1)", "ccodpago C(3)",
];

// Constantes del registro (ajústalas a tu configuración de Contasis).
const C = {
  ccodenti: "01",
  cdesenti: "MI ORGANIZACIÓN",
  ctipdoc: "6", // 6 = RUC
  cmreg: "S",
  ccond: "CON",
  cctatot: "4212", // cuenta del proveedor (42)
  nresp: 1,
  nigv: 18, // tasa IGV
  ccodpago: "008",
};

/** Código de documento Contasis a partir de la serie. */
function ccoddoc(serie: string): string {
  const s = (serie || "").toUpperCase();
  if (s.startsWith("B")) return "03"; // boleta
  if (s.startsWith("FC") || s.startsWith("07")) return "07"; // nota de crédito
  if (s.startsWith("FD") || s.startsWith("08")) return "08"; // nota de débito
  return "01"; // factura
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows: any[] = Array.isArray(body?.filas) ? body.filas : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "No hay filas que exportar." }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Registro_compras");

  // Fila 1 (etiquetas).
  const r1 = ws.getRow(1);
  for (const [col, txt] of Object.entries(FILA1)) r1.getCell(Number(col)).value = txt;
  r1.font = { bold: true };
  // Fila 2 (códigos de campo).
  const r2 = ws.getRow(2);
  FILA2.forEach((code, i) => (r2.getCell(i + 2).value = code));
  r2.font = { bold: true };

  // Datos desde la fila 3.
  rows.forEach((d, idx) => {
    const row = ws.getRow(3 + idx);
    const set = (col: number, v: any) => (row.getCell(col).value = v);
    set(2, d.fecha ?? "");           // ffechadoc
    set(3, d.fecha ?? "");           // ffechaven
    set(4, ccoddoc(d.serie));        // ccoddoc
    set(7, d.serie ?? "");           // cserie
    set(8, d.numero ?? "");          // cnumero
    set(9, C.ccodenti);              // ccodenti
    set(10, C.cdesenti);             // cdesenti
    set(11, C.ctipdoc);              // ctipdoc
    set(12, d.ruc ?? "");            // ccodruc
    set(13, d.razonSocial ?? "");    // crazsoc
    set(15, Number(d.base) || 0);    // nbase1
    set(16, Number(d.igv) || 0);     // nigv1
    set(21, 0);                      // nina
    set(24, 0);                      // nexo
    set(25, Number(d.total) || 0);   // ntots
    set(29, 1);                      // ntc
    set(34, C.cmreg);                // cmreg
    set(36, d.fecha ?? "");          // ffechaven2
    set(37, C.ccond);                // ccond
    set(38, d.cuenta ?? "");         // cctabase ← cuenta clasificada
    set(41, C.cctatot);              // cctatot
    set(44, C.nresp);                // nresp
    set(51, C.nigv);                 // nigv
    set(52, (d.glosa ?? "").slice(0, 50)); // cglosa ← glosa del XML
    set(56, C.ccodpago);             // ccodpago
  });

  // Formato numérico de los montos.
  [15, 16, 25].forEach((c) => (ws.getColumn(c).numFmt = "#,##0.00"));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="compras-contasis.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
