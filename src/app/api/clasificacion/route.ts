import { NextRequest, NextResponse } from "next/server";
import { leerFilas } from "@/lib/xlsxIO";
import { parseSireCompras } from "@/lib/cruceSire";
import { getCuentasProveedor, setCuentasProveedor } from "@/lib/db";
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

  let comps;
  try {
    const filas = await leerFilas(Buffer.from(await file.arrayBuffer()));
    comps = parseSireCompras(filas).comprobantes;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo leer el Excel." },
      { status: 400 }
    );
  }
  if (comps.length === 0) {
    return NextResponse.json({ error: "No se encontraron comprobantes en el archivo." }, { status: 400 });
  }

  const memoria = await getCuentasProveedor();

  // Agrupa por proveedor (RUC), con su razón social y montos.
  const porRuc = new Map<string, { ruc: string; razonSocial: string; comprobantes: number; monto: number }>();
  for (const c of comps) {
    const ruc = c.rucContraparte || "";
    const g = porRuc.get(ruc) ?? { ruc, razonSocial: c.razonSocial || "", comprobantes: 0, monto: 0 };
    g.comprobantes += 1;
    g.monto += c.total || 0;
    if (!g.razonSocial && c.razonSocial) g.razonSocial = c.razonSocial;
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
    // Proveedor NUEVO: rubro por decolecta (con tope) + sugerencia de cuenta.
    let rubro = "";
    let razonSocial = g.razonSocial;
    if (lookups < MAX_LOOKUPS && /^\d{11}$/.test(g.ruc)) {
      lookups++;
      const info = await consultarActividad(g.ruc);
      if (info) {
        rubro = info.actividad;
        if (info.razonSocial) razonSocial = info.razonSocial;
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
    cuenta: cuentaPorRuc.get(c.rucContraparte) ?? "",
  }));

  return NextResponse.json({
    proveedores,
    comprobantes,
    nuevos: proveedores.filter((p) => p.nuevo).length,
    totalProveedores: proveedores.length,
  });
}
