// Respuestas de las rutas que consultan SUNAT cuando la empresa es de SIMULACIÓN
// (id "demo-…"): devuelven datos ficticios coherentes y NUNCA contactan a SUNAT.
import { NextResponse } from "next/server";
import type { Cliente } from "./types";
import { esClienteDemo, perfilDe, periodosDemo, sireResumenDemo, sireDetalleDemo } from "./demo";
import { setSunatInfo, setSireResumen, setSireEstado, setSireDetalleCache } from "./db";
import { ocultarCliente } from "./secretos";
import { hoyLima } from "./fechas";

export { esClienteDemo };

const AVISO = "Empresa de simulación: este módulo no consulta SUNAT. Los datos de demostración ya están cargados en la ficha de la empresa.";

/** Para módulos sin simulación propia: aviso amable (nunca llama a SUNAT). */
export function demoNoDisponible(c: Cliente | null): NextResponse | null {
  return esClienteDemo(c) ? NextResponse.json({ error: AVISO, demo: true }, { status: 400 }) : null;
}

export async function demoSunat(c: Cliente): Promise<NextResponse> {
  const info = { ...(c.sunat as NonNullable<Cliente["sunat"]>), consultadoAt: new Date().toISOString() };
  const act = await setSunatInfo(c.id, info);
  return NextResponse.json({ cliente: ocultarCliente(act), sunat: info });
}

export async function demoSire(c: Cliente, periodo: string): Promise<NextResponse> {
  const p = perfilDe(c.id);
  if (!p || !/^\d{6}$/.test(periodo)) return NextResponse.json({ error: AVISO }, { status: 400 });
  const resumen = sireResumenDemo(p, periodo, periodosDemo(hoyLima()));
  const act = await setSireResumen(c.id, resumen);
  return NextResponse.json({ resumen, cliente: ocultarCliente(act) });
}

export async function demoSireEstado(c: Cliente, periodos: string[]): Promise<NextResponse> {
  const p = perfilDe(c.id);
  if (!p) return NextResponse.json({ error: AVISO }, { status: 400 });
  const lista = periodosDemo(hoyLima());
  const estados = (periodos.length ? periodos : lista).filter((x) => /^\d{6}$/.test(x)).map((per) => {
    const s = sireResumenDemo(p, per, lista);
    return { periodo: per, presentadoVentas: s.noObligado ? null : s.presentadoVentas, presentadoCompras: s.noObligado ? null : s.presentadoCompras };
  });
  const noObligado = p.negocio === "sin";
  await setSireEstado(c.id, estados, noObligado).catch(() => {});
  return NextResponse.json({ estados, noObligado, at: new Date().toISOString() });
}

export async function demoSireDetalle(c: Cliente, periodo: string, tipo: "ventas" | "compras"): Promise<NextResponse> {
  const p = perfilDe(c.id);
  if (!p || !/^\d{6}$/.test(periodo)) return NextResponse.json({ error: AVISO }, { status: 400 });
  const bloque = sireDetalleDemo(p, periodo, tipo);
  await setSireDetalleCache(c.id, tipo, periodo, bloque);
  return NextResponse.json({ periodo, ventas: tipo === "ventas" ? bloque : undefined, compras: tipo === "compras" ? bloque : undefined });
}

export function demoBuzon(c: Cliente): NextResponse {
  const b = c.buzon;
  const mensajes = b?.mensajes ?? [];
  return NextResponse.json({
    razonSocial: c.razonSocial, ruc: c.ruc,
    mensajes, peligrosos: b?.peligrosos ?? [], urgentes: b?.urgentes ?? [],
    totalMensajes: mensajes.length, consultadoAt: new Date().toISOString(), nuevos: [],
  });
}

export function demoItf(c: Cliente): NextResponse {
  if (!c.itf) return NextResponse.json({ error: "Empresa de simulación sin ITF (solo personas naturales)." }, { status: 400 });
  return NextResponse.json({ itf: c.itf });
}

/** Deudas F36 (fraccionamiento art. 36): devuelve lo ya "extraído" de la empresa demo. */
export function demoDeudasF36(c: Cliente): NextResponse {
  const d = c.deudasF36;
  return NextResponse.json({
    estado: d?.estado ?? "sin-pedido", estadoTexto: d?.estadoTexto ?? "", numPedido: d?.numPedido ?? null,
    fechaPedido: d?.fechaPedido ?? null, verificadoAt: d?.verificadoAt ?? null,
    tablas: d?.tablas ?? [], at: d?.at ?? null, nota: d?.nota ?? null,
    mensaje: "Empresa de simulación: deudas de demostración.",
  });
}
