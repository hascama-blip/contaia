import { NextRequest, NextResponse } from "next/server";
import { bloqueoSupremo } from "@/lib/acceso";
import { leerAccesos, mesesConAccesos } from "@/lib/registroAccesos";
import { listarAceptaciones } from "@/lib/db";

export const runtime = "nodejs";

// Evidencias para el supremo (solo él):
//   GET ?tipo=meses                              -> meses con registro (JSON)
//   GET ?tipo=accesos&mes=AAAA-MM&ruc=&email=     -> registro de accesos (CSV)
//   GET ?tipo=aceptaciones                        -> constancias de aceptación (CSV)

/** Celda CSV segura: comillas y sin fórmulas (Excel ejecuta =, +, -, @). */
function celda(v: unknown): string {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
function csv(filas: unknown[][], nombre: string) {
  const cuerpo = "﻿" + filas.map((f) => f.map(celda).join(",")).join("\r\n");
  return new NextResponse(cuerpo, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
const lima = (iso: string) => new Date(iso).toLocaleString("es-PE", { timeZone: "America/Lima", hour12: false });

export async function GET(req: NextRequest) {
  const bloqueo = await bloqueoSupremo();
  if (bloqueo) return bloqueo;
  const sp = req.nextUrl.searchParams;
  const tipo = sp.get("tipo") || "accesos";

  if (tipo === "meses") return NextResponse.json({ meses: await mesesConAccesos() });

  if (tipo === "aceptaciones") {
    const lista = (await listarAceptaciones()).sort((x, y) => y.a.fecha.localeCompare(x.a.fecha));
    return csv([
      ["Fecha (Lima)", "Fecha ISO (UTC)", "Usuario", "Correo", "Rol", "Versión", "Documentos", "Origen", "IP", "Navegador", "Huella SHA-256 del texto"],
      ...lista.map(({ usuario: u, a }) => [lima(a.fecha), a.fecha, u.nombre, u.email, u.rol ?? (u.parentId ? "operador" : "admin"), a.version, a.documentos.join(" + "), a.origen, a.ip, a.userAgent, a.huella]),
    ], `aceptaciones-politicas-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const mes = sp.get("mes") || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mes)) return NextResponse.json({ error: "Mes inválido (AAAA-MM)." }, { status: 400 });
  const eventos = await leerAccesos(mes, { ruc: sp.get("ruc") || undefined, email: sp.get("email") || undefined });
  const sufijo = [sp.get("ruc"), sp.get("email")].filter(Boolean).join("-").replace(/[^\w.@-]/g, "");
  return csv([
    ["Fecha (Lima)", "Fecha ISO (UTC)", "Evento", "Correo", "Id usuario", "IP", "Método", "Ruta", "RUC", "Razón social", "Detalle", "Navegador", "Firma válida"],
    ...eventos.map((e) => [lima(e.at), e.at, e.ev, e.email, e.uid, e.ip, e.metodo, e.ruta, e.ruc, e.razonSocial, e.detalle, e.ua, e.integro ? "SÍ" : "NO (alterada)"]),
  ], `accesos-${mes}${sufijo ? `-${sufijo}` : ""}.csv`);
}
