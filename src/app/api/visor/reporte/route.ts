import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getVisorMatriz } from "@/lib/db";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
const TIPO_LABEL: Record<string, string> = { sire: "SIRE", "dj-mensual": "DJ Mensual", "dj-anual": "DJ Anual" };
const EST: Record<string, string> = { P: "Presentó", NP: "No Presentó" };

// Reporte del Visor: un cuadro AÑO × MES por empresa y fuente (SIRE / DJ).
export async function GET() {
  const user = await requireUser();
  const mats = await getVisorMatriz(user.id);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Radar Tributar IA";

  if (!mats.length) {
    const ws = wb.addWorksheet("Visor");
    ws.addRow(["Aún no hay datos capturados. Navega el SIRE / DJ con la extensión instalada."]);
  }

  // Agrupa por empresa.
  const porEmpresa = new Map<string, typeof mats>();
  for (const m of mats) {
    const k = m.empresa || m.ruc || "Empresa";
    if (!porEmpresa.has(k)) porEmpresa.set(k, []);
    porEmpresa.get(k)!.push(m);
  }

  for (const [empresa, lista] of porEmpresa) {
    const ws = wb.addWorksheet(empresa.slice(0, 28).replace(/[\\/*?:\[\]]/g, " ") || "Empresa");
    let fila = 1;
    ws.mergeCells(fila, 1, fila, 13);
    ws.getCell(fila, 1).value = empresa + (lista[0]?.ruc ? `  ·  RUC ${lista[0].ruc}` : "");
    ws.getCell(fila, 1).font = { bold: true, size: 13 };
    fila += 2;

    for (const m of lista.sort((a, b) => a.tipo.localeCompare(b.tipo))) {
      ws.getCell(fila, 1).value = TIPO_LABEL[m.tipo] ?? m.tipo.toUpperCase();
      ws.getCell(fila, 1).font = { bold: true, color: { argb: "FF1E3A8A" } };
      fila += 1;
      // Encabezado
      const head = ws.getRow(fila);
      head.getCell(1).value = "Año";
      MESES.forEach((mm, i) => (head.getCell(i + 2).value = mm));
      head.font = { bold: true, color: { argb: "FFFFFFFF" } };
      for (let c = 1; c <= 13; c++) head.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
      fila += 1;
      // Años presentes
      const anios = new Set<string>();
      Object.keys(m.celdas).forEach((k) => anios.add(k.slice(0, 4)));
      Object.keys(m.anios).forEach((y) => anios.add(y));
      for (const y of [...anios].sort()) {
        const row = ws.getRow(fila);
        row.getCell(1).value = y;
        for (let mm = 1; mm <= 12; mm++) {
          const key = `${y}-${String(mm).padStart(2, "0")}`;
          const e = m.celdas[key];
          const cell = row.getCell(mm + 1);
          cell.value = e ? EST[e] : "";
          if (e === "NP") cell.font = { color: { argb: "FFB91C1C" }, bold: true };
          else if (e === "P") cell.font = { color: { argb: "FF15803D" } };
        }
        fila += 1;
      }
      fila += 1;
    }
    ws.getColumn(1).width = 10;
    for (let c = 2; c <= 13; c++) ws.getColumn(c).width = 12;
  }

  const ab = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(ab), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Reporte_Visor_Tributario.xlsx"`,
    },
  });
}
