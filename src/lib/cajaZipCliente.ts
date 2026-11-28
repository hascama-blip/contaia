// Caja virtual por ZIP — parte que corre en el NAVEGADOR.
// Cada ZIP del utilitario "Caja virtual · reportes por sede" (uno por sede, hasta ~75 MB) se reduce
// aquí a lo necesario (el Excel y el PDF de cada día + los vouchers y tickets del Drive) y se manda al servidor
// POR TANDAS de pocos días, para no pasar del tamaño máximo de un pedido ni de su tiempo. El
// servidor lee los vouchers (OCR) y devuelve la relación N° de operación ↔ comprobantes; aquí se
// unen las tandas. El resultado queda en memoria: el mismo ZIP no se vuelve a leer en la sesión.

import { unzipSync, zipSync } from "fflate";
import type { ResultadoOperaciones } from "./cajaOperaciones";

const TANDA_BYTES = 3 * 1024 * 1024; // pocas fotos por pedido: cada ticket o voucher se lee con OCR (1–3 s)
const TANDA_DIAS = 6;

const hechos = new Map<string, Promise<ResultadoOperaciones>>();

/** Deja del ZIP solo el Excel de cada día y los PDF del Drive que no son el reporte escaneado. */
function utiles(buf: ArrayBuffer): Map<string, Record<string, Uint8Array>> {
  const conDrive = new Set<string>();
  const util = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      const m = /(?:^|\/)(\d{4}-\d{2}-\d{2})\/(.+)$/.exec(f.name);
      if (!m) return false;
      if (/^drive\//i.test(m[2])) conDrive.add(m[1]);
      // Del día: el Excel y el PDF del reporte (trae nombre y placa). Del Drive: los PDF que no son el reporte
      // escaneado (vouchers de depósito) y los tickets de Yape / transferencias (Word con fotos o fotos sueltas).
      return (!m[2].includes("/") && /\.(xlsx|pdf)$/i.test(m[2])) || (/^drive\/[^/]+\.(pdf|docx|jpe?g|png)$/i.test(m[2]) && !/^drive\/REPORTE/i.test(m[2]));
    },
  });
  const porDia = new Map<string, Record<string, Uint8Array>>();
  for (const [ruta, data] of Object.entries(util)) {
    const m = /(?:^|\/)(\d{4}-\d{2}-\d{2})\/(.+)$/.exec(ruta)!;
    if (!porDia.has(m[1])) porDia.set(m[1], {});
    porDia.get(m[1])![`${m[1]}/${m[2]}`] = data;
  }
  // Marca de "la sede sí subió algo al Drive ese día" aunque no haya PDF de depósito (sin mandar esos archivos).
  for (const d of Array.from(conDrive)) {
    const dia = porDia.get(d) ?? porDia.set(d, {}).get(d)!;
    if (!Object.keys(dia).some((k) => k.includes("/drive/"))) dia[`${d}/drive/_sin-deposito.txt`] = new Uint8Array([32]);
  }
  return porDia;
}

function unir(partes: ResultadoOperaciones[]): ResultadoOperaciones {
  const r: ResultadoOperaciones = { sede: "", dias: 0, comprobantes: 0, total: 0, operaciones: [], sinOperacion: [], otros: [], avisos: [], tickets: { leidos: 0, vinculados: 0, sueltos: [] } };
  for (const p of partes) {
    if (!r.sede) r.sede = p.sede;
    r.dias += p.dias; r.comprobantes += p.comprobantes; r.total = Math.round((r.total + p.total) * 100) / 100;
    r.operaciones.push(...p.operaciones); r.sinOperacion.push(...(p.sinOperacion ?? [])); r.otros.push(...(p.otros ?? [])); r.avisos.push(...(p.avisos ?? []));
    r.tickets!.leidos += p.tickets?.leidos ?? 0; r.tickets!.vinculados += p.tickets?.vinculados ?? 0; r.tickets!.sueltos.push(...(p.tickets?.sueltos ?? []));
  }
  return r;
}

async function analizar(f: File, progreso: (texto: string) => void): Promise<ResultadoOperaciones> {
  let porDia: Map<string, Record<string, Uint8Array>>;
  try { porDia = utiles(await f.arrayBuffer()); } catch { throw new Error(`"${f.name}" no es un ZIP válido.`); }
  const dias = Array.from(porDia.keys()).sort();
  if (!dias.length) throw new Error(`"${f.name}" no trae carpetas por día (AAAA-MM-DD): debe ser el ZIP que descarga "Caja virtual · reportes por sede".`);
  // Tandas de pocos días / pocos MB.
  const tandas: string[][] = []; let actual: string[] = [], peso = 0;
  for (const d of dias) {
    const p = Object.values(porDia.get(d)!).reduce((a, x) => a + x.length, 0);
    if (actual.length && (peso + p > TANDA_BYTES || actual.length >= TANDA_DIAS)) { tandas.push(actual); actual = []; peso = 0; }
    actual.push(d); peso += p;
  }
  if (actual.length) tandas.push(actual);
  const partes: ResultadoOperaciones[] = []; let hechosDias = 0;
  for (const t of tandas) {
    progreso(`${f.name}: leyendo los vouchers y tickets de los días ${hechosDias + 1} a ${hechosDias + t.length} de ${dias.length}…`);
    const archivos: Record<string, Uint8Array> = {};
    for (const d of t) Object.assign(archivos, porDia.get(d)!);
    const cuerpo = zipSync(archivos, { level: 0 });
    let ultimo = "";
    for (let intento = 0; intento < 2; intento++) {
      const fd = new FormData();
      fd.append("zip", new Blob([cuerpo as unknown as BlobPart], { type: "application/zip" }), f.name);
      try {
        const r = await fetch("/api/conciliacion/operaciones", { method: "POST", body: fd });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.sede) { partes.push(d.sede); ultimo = ""; break; }
        ultimo = d.error ?? `el servidor respondió ${r.status}`;
        if (r.status < 500) break;
      } catch { ultimo = "error de red"; }
    }
    if (ultimo) throw new Error(`${f.name} (días ${t[0]} a ${t[t.length - 1]}): ${ultimo}`);
    hechosDias += t.length;
  }
  return unir(partes);
}

/** Analiza el ZIP de una sede (una sola vez por archivo en la sesión del navegador). */
export function analizarZipCaja(f: File, progreso: (texto: string) => void = () => {}): Promise<ResultadoOperaciones> {
  const k = `${f.name}|${f.size}|${f.lastModified}`;
  const ya = hechos.get(k);
  if (ya) return ya;
  const p = analizar(f, progreso);
  hechos.set(k, p);
  p.catch(() => hechos.delete(k));
  return p;
}
