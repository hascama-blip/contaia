import { NextRequest, NextResponse } from "next/server";
import { leerFilas } from "@/lib/xlsxIO";
import { esZipContenedor, extraerDeZip } from "@/lib/zip";
import { parseSireExcel, analizarSireExcel } from "@/lib/sireExcel";
import { getCuentasProveedor, setCuentasProveedor, getRubros, mergeRubros } from "@/lib/db";
import { consultarActividad } from "@/lib/sunat";
import { clasificar } from "@/lib/clasificacion";
import type { ProveedorCuenta } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 15 * 1024 * 1024;
const MAX_LOOKUPS = 120; // tope de consultas a decolecta por lote (rubro de nuevos)

// POST JSON { accion:"guardar", cuentas:[...] } -> aprende RUC→cuenta.
// POST multipart (sireCompras = Excel del SIRE RCE) -> clasifica las compras.
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  // ---- Guardar / aprender ----
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const cuentas: ProveedorCuenta[] = Array.isArray(body?.cuentas) ? body.cuentas : [];
    if (cuentas.length === 0) {
      return NextResponse.json({ error: "No hay cuentas para guardar." }, { status: 400 });
    }
    await setCuentasProveedor(cuentas);
    return NextResponse.json({ ok: true, guardadas: cuentas.length });
  }

  // ---- Clasificar (Excel del SIRE compras) ----
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  const file = form.get("sireCompras");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Adjunta el Excel del SIRE de compras (RCE)." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "El archivo supera 15 MB." }, { status: 400 });
  }

  let comps: any[] = [];
  let motivo: string | undefined;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    if (esZipContenedor(buf, file.name)) {
      // ZIP de SUNAT: lee TODOS los Excel de adentro y une los comprobantes
      // (si el SIRE viene partido en 2 archivos).
      const inner = extraerDeZip(buf, [".xlsx", ".xls"]);
      for (const it of inner) {
        try {
          const r = analizarSireExcel(await leerFilas(it.data));
          comps.push(...r.comps);
          if (r.motivo) motivo = r.motivo;
        } catch {
          /* archivo del zip que no es el detalle; se ignora */
        }
      }
    } else {
      const r = analizarSireExcel(await leerFilas(buf));
      comps = r.comps;
      motivo = r.motivo;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo leer el archivo." },
      { status: 400 }
    );
  }
  if (comps.length === 0) {
    return NextResponse.json(
      { error: motivo ?? "No se encontraron comprobantes en el archivo." },
      { status: 400 }
    );
  }

  const memoria = await getCuentasProveedor();
  const rubrosCache = await getRubros();
  const nuevosRubros: Record<string, { razonSocial: string; actividad: string }> = {};

  // Agrupa por proveedor (RUC), con su razón social, montos y la cuenta del
  // archivo (si la trae la columna "Cuenta Contable").
  const porRuc = new Map<string, { ruc: string; razonSocial: string; comprobantes: number; monto: number; cuentaArchivo?: string }>();
  for (const c of comps) {
    const ruc = c.rucContraparte || "";
    const g = porRuc.get(ruc) ?? { ruc, razonSocial: c.razonSocial || "", comprobantes: 0, monto: 0, cuentaArchivo: undefined as string | undefined };
    g.comprobantes += 1;
    g.monto += c.total || 0;
    if (!g.razonSocial && c.razonSocial) g.razonSocial = c.razonSocial;
    if (!g.cuentaArchivo && c.cuentaArchivo) g.cuentaArchivo = c.cuentaArchivo;
    porRuc.set(ruc, g);
  }

  // Resuelve la cuenta de cada proveedor: memoria > sugerencia por rubro.
  const proveedores: (ProveedorCuenta & { nuevo: boolean; comprobantes: number; monto: number })[] = [];
  let lookups = 0;
  for (const g of porRuc.values()) {
    const previo = memoria[g.ruc];
    if (previo) {
      proveedores.push({ ...previo, razonSocial: previo.razonSocial || g.razonSocial, nuevo: false, comprobantes: g.comprobantes, monto: g.monto });
      continue;
    }
    // Si el propio Excel trae la cuenta, se usa esa (no gasta decolecta).
    if (g.cuentaArchivo) {
      proveedores.push({
        ruc: g.ruc, razonSocial: g.razonSocial, rubro: "(del archivo)", cuenta: g.cuentaArchivo,
        nombreCuenta: "Cuenta del Excel", fuente: "sugerido", actualizadoAt: new Date().toISOString(),
        nuevo: false, comprobantes: g.comprobantes, monto: g.monto,
      });
      continue;
    }
    // Proveedor NUEVO: rubro desde el CACHÉ (sin gastar decolecta) o, si no
    // está, una sola consulta a decolecta (con tope) que se guarda en caché.
    let rubro = "";
    let razonSocial = g.razonSocial;
    const cacheado = rubrosCache[g.ruc];
    if (cacheado) {
      rubro = cacheado.actividad;
      if (cacheado.razonSocial) razonSocial = cacheado.razonSocial;
    } else if (lookups < MAX_LOOKUPS && /^\d{11}$/.test(g.ruc)) {
      lookups++;
      const info = await consultarActividad(g.ruc);
      if (info) {
        rubro = info.actividad;
        if (info.razonSocial) razonSocial = info.razonSocial;
        nuevosRubros[g.ruc] = { razonSocial: info.razonSocial || g.razonSocial, actividad: info.actividad };
      }
    }
    const sug = clasificar(rubro, razonSocial);
    proveedores.push({
      ruc: g.ruc,
      razonSocial,
      rubro,
      cuenta: sug.cuenta,
      nombreCuenta: sug.nombre,
      fuente: "sugerido",
      actualizadoAt: new Date().toISOString(),
      nuevo: true,
      comprobantes: g.comprobantes,
      monto: g.monto,
    });
  }
  // Guarda en caché los rubros recién consultados (1 consulta por RUC, para siempre).
  await mergeRubros(nuevosRubros);

  proveedores.sort((a, b) => Number(b.nuevo) - Number(a.nuevo) || b.monto - a.monto);

  const cuentaPorRuc = new Map(proveedores.map((p) => [p.ruc, p.cuenta]));
  const comprobantes = comps.map((c) => ({
    serie: c.serie,
    numero: c.numero,
    fecha: c.fecha,
    ruc: c.rucContraparte,
    razonSocial: c.razonSocial,
    base: c.baseGravada,
    igv: c.igv,
    total: c.total,
    cuenta: c.cuentaArchivo || cuentaPorRuc.get(c.rucContraparte) || "",
    glosa: c.glosaArchivo || "",
  }));

  return NextResponse.json({
    proveedores,
    comprobantes,
    nuevos: proveedores.filter((p) => p.nuevo).length,
    totalProveedores: proveedores.length,
  });
}
