import { bloqueoModulo } from "@/lib/acceso";
import { NextRequest, NextResponse } from "next/server";
import { requireUser, studioId } from "@/lib/auth";
import { listClientes } from "@/lib/db";
import { parseLibroDiarioHojas, claveEmpresa, type MovDiario } from "@/lib/analisisCompras";
import { leerSire, conciliar, parseRegistroVentasHojas, diarioAComprobantes, sireDesdeDetalle, periodoMasFrecuente, parseSubdiario, aplicarSubdiario, type SireLeido, type ConciliacionEmpresa, type DocSubdiario } from "@/lib/conciliacionSire";
import type { CompNorm, TipoLibro } from "@/lib/cruceSire";
import { analisisCierre, cierreAplica, type CierrePeriodo } from "@/lib/cronogramaSunat";
import { hoyLima } from "@/lib/fechas";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ARCHIVO = 15 * 1024 * 1024;
const MAX_ARCHIVOS = 40;

// POST multipart:
//   contable      = Registro de Ventas del sistema contable (una pestaña por empresa) y/o
//                   Libro Diario (compras/egresos). Se detecta solo.
//   periodo       = AAAAMM (opcional; por defecto el mes más frecuente del archivo contable)
//   sire          = (OPCIONAL) archivos SIRE subidos a mano. Por defecto el SIRE se toma
//                   de lo YA DESCARGADO en el módulo Detalle SIRE de cada empresa (el
//                   cliente con el mismo RUC en "Clientes", caché sireDetalle del periodo).
//   asignaciones  = JSON { "<id SIRE>": "<clave empresa>" } para archivos que no se pudieron ubicar.
//   subdiario     = (OPCIONAL, después del análisis) subdiario de MISCELÁNEOS u otro donde
//                   contabilidad registró NC/comprobantes fuera del Registro de Ventas: las
//                   diferencias "Solo SIRE" que estén ahí (mismo tipo + serie + número y
//                   monto) quedan conciliadas.
// → conciliación SIRE vs contabilidad POR EMPRESA, comprobante por comprobante.
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("analisis-rtp"); if (_bloqueo) return _bloqueo;
  const user = await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido." }, { status: 400 });
  const archivos = (k: string) => form.getAll(k).filter((f): f is File => f instanceof File && f.size > 0);
  const contables = archivos("contable");
  const sires = archivos("sire");
  const subdiarios = archivos("subdiario");
  if (!contables.length) return NextResponse.json({ error: "Sube el Registro de Ventas del sistema contable (una pestaña por empresa)." }, { status: 400 });
  if (contables.length + sires.length + subdiarios.length > MAX_ARCHIVOS) return NextResponse.json({ error: `Máximo ${MAX_ARCHIVOS} archivos por vez.` }, { status: 400 });
  const grande = [...contables, ...sires, ...subdiarios].find((f) => f.size > MAX_ARCHIVO);
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

    // Clientes del estudio (para tomar el SIRE ya descargado en Detalle SIRE).
    const clientes = await listClientes(studioId(user));
    const periodoPedido = /^\d{6}$/.test(String(form.get("periodo") || "")) ? String(form.get("periodo")) : "";

    // SIRE subidos a mano (opcional): por RUC de la empresa, por razón social o a mano.
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
    // Empresas sin SIRE: no están en Clientes o aún no se descargó su Detalle SIRE del periodo.
    const faltantes: { empresa: string; ruc: string; libro: TipoLibro; periodo: string; motivo: "sin-cliente" | "sin-detalle"; clienteId?: string }[] = [];
    let periodoUsado = periodoPedido;
    for (const [k, e] of empresas.entries()) {
      for (const libro of ["ventas", "compras"] as TipoLibro[]) {
        const tieneContable = libro === "ventas" ? e.ventas.length > 0 : e.diario.length > 0;
        let ss = asignados.get(`${k}|${libro}`);
        if (!tieneContable) {
          if (ss) avisos.push(`${e.empresa}: hay SIRE de ${libro} pero no su ${libro === "ventas" ? "Registro de Ventas" : "Libro Diario"} contable.`);
          continue;
        }
        const periodo = periodoPedido || periodoMasFrecuente(libro === "ventas" ? e.ventas.map((c) => c.fecha) : e.diario.map((m) => m.fecReg || m.fecDoc));
        if (!periodoUsado) periodoUsado = periodo;
        if (!ss) {
          // SIRE desde el módulo Detalle SIRE (sin subir archivos).
          const cli = (e.ruc && clientes.find((c) => c.ruc === e.ruc)) || clientes.find((c) => claveEmpresa(c.razonSocial) === k);
          if (!e.ruc && cli) e.ruc = cli.ruc;
          const cache = cli?.sireDetalle?.[`${libro}-${periodo}`];
          if (!cli) { faltantes.push({ empresa: e.empresa, ruc: e.ruc, libro, periodo, motivo: "sin-cliente" }); sinSire.push(e.empresa); continue; }
          if (!cache || !cache.filas?.length) { faltantes.push({ empresa: e.empresa, ruc: e.ruc, libro, periodo, motivo: "sin-detalle", clienteId: cli.id }); sinSire.push(e.empresa); continue; }
          const r = sireDesdeDetalle(cache, `detalle:${cli.id}:${libro}`, `Detalle SIRE ${libro} ${periodo} (descargado ${cache.at?.slice(0, 10) ?? ""})`);
          if (typeof r === "string") { avisos.push(`${e.empresa}: ${r}`); continue; }
          if (r.libro !== libro) { avisos.push(`${e.empresa}: el Detalle SIRE guardado no es de ${libro}.`); continue; }
          ss = [r];
        }
        if (libro === "ventas") resultados.push(conciliar("ventas", e.empresa, k, e.ventas, ss));
        else {
          const d = diarioAComprobantes(e.diario);
          resultados.push(conciliar("compras", e.empresa, k, d.comprobantes, ss, d.documento, d.excluidos));
        }
        const ult = resultados[resultados.length - 1];
        if (!ult.ruc) ult.ruc = e.ruc;
        if (!ult.periodo) ult.periodo = periodo;
      }
    }
    // Subdiario de misceláneos: anula las diferencias "Solo SIRE" que estén registradas ahí.
    if (subdiarios.length) {
      const porEmpresa = new Map<string, { docs: DocSubdiario[]; archivos: string[] }>();
      const ventasRes = resultados.filter((r) => r.libro === "ventas");
      for (const f of subdiarios) {
        const hojas = await parseSubdiario(Buffer.from(await f.arrayBuffer()), parseLibroDiarioHojas);
        if (!hojas.length) avisos.push(`"${f.name}": no se reconocieron comprobantes (se espera Documento + Total, o Cuenta + Debe + Haber).`);
        for (const h of hojas) {
          let k = (h.ruc && [...empresas.entries()].find(([, e]) => e.ruc === h.ruc)?.[0]) || "";
          if (!k && empresas.has(claveEmpresa(h.empresa))) k = claveEmpresa(h.empresa);
          if (!k && ventasRes.length === 1) k = ventasRes[0].clave; // una sola empresa conciliada
          if (!k) { avisos.push(`Subdiario "${f.name}" · pestaña ${h.hoja}: no se pudo ubicar la empresa ("${h.empresa}").`); continue; }
          const g = porEmpresa.get(k) ?? porEmpresa.set(k, { docs: [], archivos: [] }).get(k)!;
          g.docs.push(...h.docs);
          g.archivos.push(hojas.length > 1 ? `${f.name} · ${h.hoja}` : f.name);
        }
      }
      for (const r of ventasRes) {
        const g = porEmpresa.get(r.clave);
        if (!g) continue;
        // Aviso si el subdiario es de otro mes que la conciliación (no cruzaría nada).
        const perSub = periodoMasFrecuente(g.docs.map((d) => d.fecha));
        if (perSub && r.periodo && perSub !== r.periodo) {
          avisos.push(`${r.empresa}: el subdiario es del periodo ${perSub.slice(4)}/${perSub.slice(0, 4)} y la conciliación es de ${r.periodo.slice(4)}/${r.periodo.slice(0, 4)}; solo se cruzan las NC del mismo periodo.`);
        }
        aplicarSubdiario(r, g.docs, g.archivos);
      }
    }

    // ANÁLISIS DE CIERRE: vencimiento de la DJ mensual (cronograma SUNAT por último
    // dígito del RUC) y cuánto tiempo queda para regularizar las diferencias.
    const hoy = hoyLima();
    // Solo aplica al periodo POR DECLARAR (mes anterior) y al mes en curso; los meses
    // pasados ya debieron declararse (no se les cuenta plazo).
    const cierre: (CierrePeriodo & { empresa: string; ruc: string; conciliada: boolean; pendientes: number; difTotal: number; difIgv: number })[] = [];
    let cierreNoAplica = "";
    for (const [k, e] of empresas.entries()) {
      const rs = resultados.filter((r) => r.clave === k);
      const per = rs[0]?.periodo || periodoPedido || periodoMasFrecuente(e.ventas.length ? e.ventas.map((c) => c.fecha) : e.diario.map((m) => m.fecReg || m.fecDoc));
      const ruc = e.ruc || rs[0]?.ruc || "";
      if (!cierreAplica(per, hoy)) { cierreNoAplica = per; continue; }
      const c = analisisCierre(ruc, per, hoy);
      for (const r of rs) r.cierre = c;
      if (!c) continue;
      const pend = rs.reduce((a, r) => a + r.cruce.difMonto + r.cruce.difFecha + r.cruce.soloSire + r.cruce.soloContable + r.docDistinto, 0);
      cierre.push({
        ...c, empresa: e.empresa, ruc, conciliada: rs.length > 0, pendientes: pend,
        difTotal: Math.round(rs.reduce((a, r) => a + r.cruce.totalesSire.total - r.cruce.totalesContable.total, 0) * 100) / 100,
        difIgv: Math.round(rs.reduce((a, r) => a + r.cruce.totalesSire.igv - r.cruce.totalesContable.igv, 0) * 100) / 100,
      });
    }
    const orden = { vencido: 0, "vence-hoy": 1, urgente: 2, "en-plazo": 3 } as const;
    cierre.sort((a, b) => orden[a.estado] - orden[b.estado] || a.diasCalendario - b.diasCalendario || b.pendientes - a.pendientes);

    return NextResponse.json({
      hoy,
      cierre,
      cierreNoAplica,
      empresas: resultados,
      sinSire,
      faltantes,
      periodo: periodoUsado,
      sinEmpresa,
      avisos,
      empresasDisponibles: [...empresas.entries()].map(([clave, e]) => ({ clave, empresa: e.empresa })),
    });
  } catch (e: any) {
    console.error("[analisis-compras/conciliacion]", e);
    return NextResponse.json({ error: e?.message ?? "No se pudieron leer los archivos." }, { status: 500 });
  }
}
