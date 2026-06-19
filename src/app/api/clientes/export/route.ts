import { NextResponse } from "next/server";
import { listClientes } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exporta la relación de clientes DEL USUARIO (razón social, RUC, correo,
// celular) en CSV — la "data" de contactos para descargar.
export async function GET() {
  const user = await requireUser();
  const clientes = await listClientes(user.id);
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const filas = [
    ["Razon Social", "RUC", "Correo", "Celular", "Estado SUNAT", "Condicion", "Creado"],
    ...clientes.map((c) => [
      c.razonSocial,
      c.ruc,
      c.email || "",
      c.telefono || "",
      c.sunat?.estado || "",
      c.sunat?.condicion || "",
      c.createdAt?.slice(0, 10) || "",
    ]),
  ];
  // BOM para que Excel respete tildes.
  const csv = "﻿" + filas.map((f) => f.map((x) => esc(String(x))).join(",")).join("\r\n");
  const hoy = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contactos-clientes-${hoy}.csv"`,
    },
  });
}
