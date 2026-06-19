import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================
//  Masivo de COMPRAS / VENTAS en el formato de importación de Contasis
// ============================================================
// Replica las plantillas Registro_compras / Registro_ventas (2 filas de
// cabecera + datos desde la fila 3, columna A vacía). La cuenta va en cctabase
// y la descripción del XML en cglosa.

const pad = (x: any) => String(x).padStart(2, "0");
const fmtD = (d: Date) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
function aFechaDDMMAAAA(v: any): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) return fmtD(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return `${pad(m[1])}/${pad(m[2])}/${m[3]}`;
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return `${pad(m[3])}/${pad(m[2])}/${m[1]}`;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 59 && n < 90000) return fmtD(new Date(Date.UTC(1899, 11, 30) + n * 86400000));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : fmtD(d);
}
function ccoddoc(serie: string): string {
  const s = (serie || "").toUpperCase();
  if (s.startsWith("B")) return "03";
  if (s.startsWith("FC") || s.startsWith("07")) return "07";
  if (s.startsWith("FD") || s.startsWith("08")) return "08";
  return "01";
}

const CDESENTI = "MI ORGANIZACIÓN";

// ---- COMPRAS (Registro_compras, 56 columnas) ----
const COMPRAS_F1: Record<number, string> = {
  2: "FECHA EMISION", 4: "FACTURA, BOLETA, NOTA DE CREDITO O DEBITO",
  9: "SE MANTIENE", 10: "SE MANTIENE", 29: "TIPO DE CAMBIO", 44: "SE MANTIENE", 56: "SE MANTIENE",
};
const COMPRAS_F2 = [
  "ffechadoc D","ffechaven D","ccoddoc C(2)","ccoddas C(3)","cyeardas C(4)","cserie C(20)","cnumero C(20)","ccodenti C(11)","cdesenti C(100)","ctipdoc C(1)","ccodruc C(15)","crazsoc C(100)","ccodclas C(1)","nbase1 N(15,2)","nigv1 N(15,2)","nbase2 N(15,2)","nigv2 N(15,2)","nbase3 N(15,2)","nigv3 N(15,2)","nina N(15,2)","nisc N(15,2)","nicbper N(15,2)","nexo N(15,2)","ntots N(15,2)","cdocnodom C(20)","cnumdere C(15)","ffecre D","ntc N(10,6)","freffec D","crefdoc C(2)","crefser C(6)","crefnum C(13)","cmreg C(1)","ndolar N(15,2)","ffechaven2 D","ccond C(3)","cctabase C(10)","cctaicbper C(10)","cctaotrib C(10)","cctatot C(10)","ccodcos C(9)","ccodcos2 C(9)","nresp N(1)","nporre N(5,2)","nimpres N(15,2)","cserre C(6)","cnumre C(13)","ffecre2 D","ccodpresu C(10)","nigv N(5,2)","cglosa C(50)","nperdenre N(1)","nbaseres N(15,2)","cigvxacre C(1)","ccodpago C(3)",
];
function filaCompras(row: ExcelJS.Row, d: any) {
  const f = aFechaDDMMAAAA(d.fecha);
  const set = (c: number, v: any) => (row.getCell(c).value = v);
  set(2, f); set(3, f); set(4, ccoddoc(d.serie));
  set(7, d.serie ?? ""); set(8, d.numero ?? "");
  set(9, "01"); set(10, CDESENTI); set(11, "6");
  set(12, d.ruc ?? ""); set(13, d.razonSocial ?? "");
  set(15, Number(d.base) || 0); set(16, Number(d.igv) || 0);
  set(21, 0); set(24, 0); set(25, Number(d.total) || 0);
  set(29, 1); set(34, "S"); set(36, f); set(37, "CON");
  set(38, d.cuenta ?? ""); set(41, "4212"); set(44, 1); set(51, 18);
  set(52, (d.glosa ?? "").slice(0, 50)); set(56, "008");
}

// ---- VENTAS (Registro_ventas, 48 columnas) ----
const VENTAS_F1: Record<number, string> = {
  2: "fecha emision", 7: "se mantiene", 8: "se mantiene",
  29: "se mantiene", 32: "se mantiene", 35: "se mantiene", 45: "se mantiene",
};
const VENTAS_F2 = [
  "ffechadoc D","ffechaven D","ccoddoc C(2)","cserie C(20)","cnumero C(20)","ccodenti C(11)","cdesenti C(100)","ctipdoc C(1)","ccodruc C(15)","crazsoc C(100)","nbase2 N(15,2)","nbase1 N(15,2)","nexo N(15,2)","nina N(15,2)","nisc N(15,2)","nigv1 N(15,2)","nicbpers N(15,2)","nbase3 N(15,2)","ntots N(15,2)","ntc N(10,6)","freffec D","crefdoc C(2)","crefser C(6)","crefnum C(13)","cmreg C(1)","ndolar N(15,2)","ffechaven2 D","ccond C(3)","ccodcos C(9)","ccodcos2 C(9)","cctabase C(20)","cctaicbper C(20)","cctaotrib C(20)","cctatot C(20)","nresp N(1)","nporre N(5,2)","nimpres N(15,2)","cserre C(6)","cnumre C(13)","ffecre D","ccodpresu C(10)","nigv N(5,2)","cglosa C(80)","ccodpago C(3)","nperdenre N(1)","nbaseres N(15,2)","cctaperc C(20)",
];
function filaVentas(row: ExcelJS.Row, d: any) {
  const f = aFechaDDMMAAAA(d.fecha);
  const set = (c: number, v: any) => (row.getCell(c).value = v);
  set(2, f); set(3, f); set(4, ccoddoc(d.serie));
  set(5, d.serie ?? ""); set(6, d.numero ?? "");
  set(7, "01"); set(8, CDESENTI); set(9, "6");
  set(10, d.ruc ?? ""); set(11, d.razonSocial ?? "");
  set(13, Number(d.base) || 0); set(17, Number(d.igv) || 0); set(20, Number(d.total) || 0);
  set(21, 1); set(26, "S"); set(28, f); set(29, "CON");
  set(32, d.cuenta ?? ""); set(35, "1212"); set(36, 1); set(43, 18);
  set(44, (d.glosa ?? "").slice(0, 80)); set(45, "001");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows: any[] = Array.isArray(body?.filas) ? body.filas : [];
  const libro = body?.libro === "ventas" ? "ventas" : "compras";
  if (rows.length === 0) {
    return NextResponse.json({ error: "No hay filas que exportar." }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(libro === "ventas" ? "Registro_ventas" : "Registro_compras");
  const F1 = libro === "ventas" ? VENTAS_F1 : COMPRAS_F1;
  const F2 = libro === "ventas" ? VENTAS_F2 : COMPRAS_F2;

  const r1 = ws.getRow(1);
  for (const [col, txt] of Object.entries(F1)) r1.getCell(Number(col)).value = txt;
  r1.font = { bold: true };
  const r2 = ws.getRow(2);
  F2.forEach((code, i) => (r2.getCell(i + 2).value = code));
  r2.font = { bold: true };

  rows.forEach((d, idx) => {
    const row = ws.getRow(3 + idx);
    if (libro === "ventas") filaVentas(row, d);
    else filaCompras(row, d);
  });

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${libro}-contasis.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
