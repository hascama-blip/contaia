// ============================================================
//  Reporte Electrónico de Rentas y Retenciones (4ta / 5ta categoría)
// ============================================================
// SUNAT genera un PDF (con capa de texto) que llega por correo. Aquí se PARSEA
// ese PDF (con unpdf, sin OCR) y se arma el detalle por empleador y periodo:
// concepto (4ta/5ta), monto de retención y monto de renta, con totales.

export interface FilaRenta {
  empleador: string;
  periodo: string;      // MMYYYY tal como SUNAT (ej. "102024")
  periodoTxt: string;   // "10/2024"
  concepto: "4ta" | "5ta";
  retencion: number;
  renta: number;
}

export interface GrupoEmpleador {
  empleador: string;
  filas: FilaRenta[];
  totalRetencion: number;
  totalRenta: number;
}

export interface ReporteRentas {
  anio: string;
  titular: string;
  documento: string;
  filas: FilaRenta[];
  porEmpleador: GrupoEmpleador[];
  totalRenta4ta: number;
  totalRenta5ta: number;
  totalRetencion4ta: number;
  totalRetencion5ta: number;
  totalRetencion: number;
  totalRenta: number;
  /** Texto crudo (para modo diagnóstico / calibrar). */
  textoCrudo?: string;
}

const num = (s: string) => Number(String(s).replace(/[^\d.-]/g, "")) || 0;

/** Extrae el texto del PDF con unpdf (pdf.js serverless, sin OCR). */
export async function textoDePdf(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const res: any = await extractText(pdf, { mergePages: true });
  const text: any = res?.text;
  if (typeof text === "string") return text;
  if (Array.isArray(text)) return text.join("\n");
  return String(text ?? "");
}

/** Parsea el texto del Reporte de Rentas y Retenciones. */
export function parseReporteRentas(texto: string): ReporteRentas {
  const t = String(texto || "").replace(/\s+/g, " ").trim();

  const anio = (t.match(/A[ñn]o consultado:\s*(\d{4})/i) || [])[1] || "";
  // El titular es el nombre EN MAYÚSCULAS que precede a "DNI -" (tras la fecha).
  const titular =
    (t.match(/([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ&.'\- ]{4,}?)\s*(?:DNI|RUC|C\.?E\.?)\s*[-–]/) || [])[1]?.replace(/\s+/g, " ").trim() ||
    (t.match(/Reporte de Rentas y Retenciones\s+(.+?)\s+DNI/i) || [])[1]?.trim() || "";
  const documento = (t.match(/(DNI|RUC|C\.?E\.?)\s*[-–\s]*([\d]{6,12})/i) || []).slice(1).join(" ").trim() || "";

  // Cada fila: <empleador> <MMYYYY> <4ta|5ta> categoría S/ <renta> S/ <retención>.
  // ⚠️ El PDF lista PRIMERO "Monto de renta" y LUEGO "Monto de retención"
  // (m[4]=renta, m[5]=retención). El empleador no tiene dígitos; se captura de
  // forma no-voraz hasta el periodo.
  const re = /([A-Za-zÁÉÍÓÚÑáéíóúñ&.,()\-\/ ]+?)\s(\d{6})\s(4ta|5ta)\s*categor[íi]a\s*S\/\s*([\d.,]+)\s*S\/\s*([\d.,]+)/gi;
  const filas: FilaRenta[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    // Limpia el empleador de la cabecera que queda pegada en la 1ª fila del grupo
    // ("…Monto de rentaMonto de retención EMPLEADOR"). Greedy hasta la cabecera.
    let emp = m[1]
      .replace(/^.*Monto de retenci[óo]n\s*/i, "")
      .replace(/^.*Monto de renta\s*/i, "")
      .replace(/^(Periodo|Concepto|Empleador)\s*/i, "")
      .replace(/^[-\s]+/, "")
      .trim();
    const periodo = m[2];
    const mm = periodo.slice(0, 2), yy = periodo.slice(2);
    filas.push({
      empleador: emp,
      periodo,
      periodoTxt: `${mm}/${yy}`,
      concepto: /4ta/i.test(m[3]) ? "4ta" : "5ta",
      renta: num(m[4]),       // 1ª columna = Monto de renta
      retencion: num(m[5]),   // 2ª columna = Monto de retención
    });
  }

  // Agrupar por empleador (respetando el orden de aparición).
  const orden: string[] = [];
  const mapa = new Map<string, FilaRenta[]>();
  for (const f of filas) {
    if (!mapa.has(f.empleador)) { mapa.set(f.empleador, []); orden.push(f.empleador); }
    mapa.get(f.empleador)!.push(f);
  }
  const porEmpleador: GrupoEmpleador[] = orden.map((emp) => {
    const fs = mapa.get(emp)!;
    return {
      empleador: emp,
      filas: fs,
      totalRetencion: fs.reduce((a, x) => a + x.retencion, 0),
      totalRenta: fs.reduce((a, x) => a + x.renta, 0),
    };
  });

  const sum4ta = (k: "renta" | "retencion") => filas.filter((f) => f.concepto === "4ta").reduce((a, x) => a + x[k], 0);
  const sum5ta = (k: "renta" | "retencion") => filas.filter((f) => f.concepto === "5ta").reduce((a, x) => a + x[k], 0);
  return {
    anio, titular, documento, filas, porEmpleador,
    totalRenta4ta: sum4ta("renta"), totalRenta5ta: sum5ta("renta"),
    totalRetencion4ta: sum4ta("retencion"), totalRetencion5ta: sum5ta("retencion"),
    totalRetencion: filas.reduce((a, x) => a + x.retencion, 0),
    totalRenta: filas.reduce((a, x) => a + x.renta, 0),
  };
}
