import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { parseLibroDiarioHojas, claveEmpresa, type MovDiario } from "@/lib/analisisCompras";
import { leerSire, conciliar, parseRegistroVentasHojas, diarioAComprobantes, type SireLeido, type ConciliacionEmpresa } from "@/lib/conciliacionSire";
import type { CompNorm, TipoLibro } from "@/lib/cruceSire";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ARCHIVO = 15 * 1024 * 1024;
const MAX_ARCHIVOS = 40;

// POST multipart:
//   contable      = Registro de Ventas del sistema contable (una pestaña por empresa) y/o
//                   Libro Diario (compras/egresos). Se detecta solo.
//   sire          = SIRE de cada empresa (ventas RVIE o compras RCE): Excel, TXT o ZIP de SUNAT.
//   asignaciones  = JSON { "<id SIRE>": "<clave empresa>" } para los SIRE que no se pudieron ubicar.
// → conciliación SIRE vs contabilidad POR EMPRESA, comprobante por comprobante.
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("analisis-rtp"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido." }, { status: 400 });
  const archivos = (k: string) => form.getAll(k).filter((f): f is File => f instanceof File && f.size > 0);
  const contables = archivos("contable");
  const sires = archivos("sire");
  if (!contables.length) return NextResponse.json({ error: "Sube el Registro de Ventas del sistema contable (una pestaña por empresa)." }, { status: 400 });
  if (!sires.length) return NextResponse.json({ error: "Sube el SIRE de las empresas." }, { status: 400 });
  if (contables.length + sires.length > MAX_ARCHIVOS) return NextResponse.json({ error: `Máximo ${MAX_ARCHIVOS} archivos por vez.` }, { status: 400 });
  const grande = [...contables, ...sires].find((f) => f.size > MAX_ARCHIVO);
  if (grande) return NextResponse.json({ error: `"${grande.name}" supera 15 MB.` }, { status: 400 });
  let asignaciones: Record<string, string> = {};
  try { asignaciones = JSON.parse(String(form.get("asignaciones") || "{}")) || {}; } catch { /* sin asignaciones */ }

  try {
    // Empresas de la contabilidad (Registro de Ventas y/o Libro Diario).
    type Emp = { empresa: string; ruc: string; ventas: CompNorm[]; diario: MovDiario[] };
    const empresas = new Map<string, Emp>();
    const emp = (nombre: string, hoja: string): Emp => {
      const k = claveEmpresa(nombre) || hoja;
      return empresas.get(k) ?? empresas.set(k, { empresa: nombre, ruc: "", ventas: [], diario: [] }).get(k)!;
    };
    for (const f of contables) {
      const buf = Buffer.from(await f.arrayBuffer());
      for (const h of await parseRegistroVentasHojas(buf)) {
        const e = emp(h.empresa, h.hoja);
        e.ventas.push(...h.comprobantes);
        if (!e.ruc) e.ruc = h.ruc;
      }
      for (const h of await parseLibroDiarioHojas(buf)) emp(h.empresa, h.hoja).diario.push(...h.movimientos);
    }
    if (!empresas.size) return NextResponse.json({ error: "No se reconoció el archivo contable (Registro de Ventas con columnas Documento, Afecto, IGV, Total… o Libro Diario)." }, { status: 422 });

    // SIRE leídos y ubicados: por RUC de la empresa, por razón social o a mano.
    const avisos: string[] = [];
    const asignados = new Map<string, SireLeido[]>(); // "<clave>|<libro>"
    const sinEmpresa: { id: string; nombre: string; libro: TipoLibro; razonSocial: string; ruc: string; comprobantes: number }[] = [];
    for (const [i, f] of sires.entries()) {
      const r = await leerSire(Buffer.from(await f.arrayBuffer()), f.name, i);
      avisos.push(...r.avisos);
      for (const s of r.leidos) {
        const manual = asignaciones[s.id];
        let k = manual && empresas.has(manual) ? manual : "";
        if (!k && s.ruc) k = [...empresas.entries()].find(([, e]) => e.ruc === s.ruc)?.[0] ?? "";
        if (!k && empresas.has(claveEmpresa(s.razonSocial))) k = claveEmpresa(s.razonSocial);
        if (k) (asignados.get(`${k}|${s.libro}`) ?? asignados.set(`${k}|${s.libro}`, []).get(`${k}|${s.libro}`)!).push(s);
        else sinEmpresa.push({ id: s.id, nombre: s.nombre, libro: s.libro, razonSocial: s.razonSocial, ruc: s.ruc, comprobantes: s.comprobantes.length });
      }
    }

    const resultados: ConciliacionEmpresa[] = [];
    const sinSire: string[] = [];
    for (const [k, e] of empresas.entries()) {
      for (const libro of ["ventas", "compras"] as TipoLibro[]) {
        const tieneContable = libro === "ventas" ? e.ventas.length > 0 : e.diario.length > 0;
        const ss = asignados.get(`${k}|${libro}`);
        if (!tieneContable) {
          if (ss) avisos.push(`${e.empresa}: hay SIRE de ${libro} pero no su ${libro === "ventas" ? "Registro de Ventas" : "Libro Diario"} contable.`);
          continue;
        }
        if (!ss) { sinSire.push(`${e.empresa}${libro === "compras" ? " (compras)" : ""}`); continue; }
        if (libro === "ventas") resultados.push(conciliar("ventas", e.empresa, k, e.ventas, ss));
        else {
          const d = diarioAComprobantes(e.diario);
          resultados.push(conciliar("compras", e.empresa, k, d.comprobantes, ss, d.documento, d.excluidos));
        }
        if (!resultados[resultados.length - 1].ruc) resultados[resultados.length - 1].ruc = e.ruc;
      }
    }
    return NextResponse.json({
      empresas: resultados,
      sinSire,
      sinEmpresa,
      avisos,
      empresasDisponibles: [...empresas.entries()].map(([clave, e]) => ({ clave, empresa: e.empresa })),
    });
  } catch (e: any) {
    console.error("[analisis-compras/conciliacion]", e);
    return NextResponse.json({ error: e?.message ?? "No se pudieron leer los archivos." }, { status: 500 });
  }
}
