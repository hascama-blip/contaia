import { NextRequest, NextResponse } from "next/server";
import { parseFacturaXml } from "@/lib/facturaXml";
import { esZip, extraerDeZip } from "@/lib/zip";
import { getCuentasProveedor, setCuentasProveedor, getRubros, mergeRubros } from "@/lib/db";
import { consultarActividad } from "@/lib/sunat";
import { clasificar } from "@/lib/clasificacion";
import type { ProveedorCuenta } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 8 * 1024 * 1024;
const MAX_LOOKUPS = 120;

// POST JSON { accion:"guardar", cuentas } -> aprende RUC→cuenta.
// POST multipart (varios `file` = XML de comprobantes) -> lee detalle + clasifica.
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const cuentas: ProveedorCuenta[] = Array.isArray(body?.cuentas) ? body.cuentas : [];
    if (cuentas.length === 0) {
      return NextResponse.json({ error: "No hay cuentas para guardar." }, { status: 400 });
    }
    await setCuentasProveedor(cuentas);
    return NextResponse.json({ ok: true, guardadas: cuentas.length });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
  const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: "Adjunta los XML de las facturas." }, { status: 400 });
  }

  // Lee cada archivo: si es ZIP, saca todos los XML de adentro (subcarpetas
  // incluidas); si es XML, se usa directo.
  const xmls: { name: string; xml: string }[] = [];
  const errores: string[] = [];
  for (const f of files) {
    if (f.size > MAX_SIZE) {
      errores.push(`${f.name}: supera 8 MB`);
      continue;
    }
    const buf = Buffer.from(await f.arrayBuffer());
    if (esZip(buf)) {
      const inner = extraerDeZip(buf, [".xml"]);
      if (inner.length === 0) errores.push(`${f.name}: el ZIP no contiene XML`);
      for (const it of inner) xmls.push({ name: it.name, xml: it.data.toString("utf-8") });
    } else {
      xmls.push({ name: f.name, xml: buf.toString("utf-8") });
    }
  }

  // Parsea cada XML.
  const parsed = [];
  for (const { name, xml } of xmls) {
    const fx = parseFacturaXml(xml);
    if (fx && fx.rucEmisor) parsed.push(fx);
    else errores.push(`${name}: no es un XML de comprobante válido`);
  }
  if (parsed.length === 0) {
    return NextResponse.json(
      { error: `No se pudo leer ningún XML. ${errores.slice(0, 3).join(" · ")}` },
      { status: 400 }
    );
  }

  // Clasifica por proveedor (memoria > caché de rubro > decolecta una vez).
  const memoria = await getCuentasProveedor();
  const rubrosCache = await getRubros();
  const nuevosRubros: Record<string, { razonSocial: string; actividad: string }> = {};

  const rucs = Array.from(new Set(parsed.map((p) => p.rucEmisor)));
  const cuentaPorRuc = new Map<string, string>();
  const proveedores: (ProveedorCuenta & { nuevo: boolean })[] = [];
  let lookups = 0;

  for (const ruc of rucs) {
    const muestra = parsed.find((p) => p.rucEmisor === ruc);
    const razonBase = muestra?.razonSocialEmisor ?? "";
    const previo = memoria[ruc];
    if (previo) {
      cuentaPorRuc.set(ruc, previo.cuenta);
      proveedores.push({ ...previo, razonSocial: previo.razonSocial || razonBase, nuevo: false });
      continue;
    }
    let rubro = "";
    let razonSocial = razonBase;
    const cacheado = rubrosCache[ruc];
    if (cacheado) {
      rubro = cacheado.actividad;
      if (cacheado.razonSocial) razonSocial = cacheado.razonSocial;
    } else if (lookups < MAX_LOOKUPS && /^\d{11}$/.test(ruc)) {
      lookups++;
      const info = await consultarActividad(ruc);
      if (info) {
        rubro = info.actividad;
        if (info.razonSocial) razonSocial = info.razonSocial;
        nuevosRubros[ruc] = { razonSocial: info.razonSocial || razonBase, actividad: info.actividad };
      }
    }
    const sug = clasificar(rubro, razonSocial);
    cuentaPorRuc.set(ruc, sug.cuenta);
    proveedores.push({
      ruc,
      razonSocial,
      rubro,
      cuenta: sug.cuenta,
      nombreCuenta: sug.nombre,
      fuente: "sugerido",
      actualizadoAt: new Date().toISOString(),
      nuevo: true,
    });
  }
  await mergeRubros(nuevosRubros);
  proveedores.sort((a, b) => Number(b.nuevo) - Number(a.nuevo));

  const facturas = parsed.map((p) => ({
    tipo: p.tipo,
    serieNumero: p.serieNumero,
    fecha: p.fecha,
    ruc: p.rucEmisor,
    razonSocial: p.razonSocialEmisor,
    glosa: p.glosa,
    moneda: p.moneda,
    base: p.base,
    igv: p.igv,
    total: p.total,
    cuenta: cuentaPorRuc.get(p.rucEmisor) ?? "",
    lineas: p.lineas,
  }));

  return NextResponse.json({
    facturas,
    proveedores,
    nuevos: proveedores.filter((p) => p.nuevo).length,
    leidas: facturas.length,
    errores,
  });
}
