import { bloqueoModulo, limpiarDiagnostico, estudioMemoria } from "@/lib/acceso";
import { esRucDemo } from "@/lib/demo";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { extraerHonorarios } from "@/lib/honorarios";
import { getCuentasHonorarios } from "@/lib/db";
import { comprobantesDisponibles, sumarComprobantes, mensajeTopeComprobantes } from "@/lib/cupos";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST → extrae los Recibos por Honorarios (Consulta Receptor) del rango de meses.
export async function POST(req: NextRequest) {
  const _bloqueo = await bloqueoModulo("comprobantes-xml", "honorarios"); if (_bloqueo) return _bloqueo;
  await requireUser();
  const body = await req.json().catch(() => ({}));
  await limpiarDiagnostico(body);
  const rucLogin = String(body.rucLogin ?? body.ruc ?? "").replace(/\D/g, "");
  if (esRucDemo(rucLogin)) return NextResponse.json({ error: "Empresa de simulación: este módulo no consulta SUNAT con datos ficticios." }, { status: 400 });
  const solUser = typeof body.solUser === "string" ? body.solUser : "";
  const solPass = typeof body.solPass === "string" ? body.solPass : "";
  const desde = typeof body.desde === "string" ? body.desde : undefined; // "YYYYMM"
  const hasta = typeof body.hasta === "string" ? body.hasta : undefined;
  const diagnostico = body.diagnostico === true;

  if (!/^\d{11}$/.test(rucLogin)) return NextResponse.json({ error: "RUC de acceso SOL inválido (11 dígitos)." }, { status: 400 });
  if (!solUser || !solPass) return NextResponse.json({ error: "Ingresa el Usuario SOL y la Clave SOL." }, { status: 400 });

  // Tope del plan: los recibos cuentan como comprobantes de la Descarga masiva.
  const tope = diagnostico ? null : await comprobantesDisponibles();
  if (tope && tope.disponibles !== null && tope.disponibles <= 0) {
    return NextResponse.json({ error: mensajeTopeComprobantes(tope.tope!), sinCupo: true }, { status: 429 });
  }

  // Memoria del mes anterior (emisor+concepto → cuentas) para heredar cuentas.
  const mapaCuentas = await getCuentasHonorarios(await estudioMemoria()).catch(() => ({}));
  const r = await extraerHonorarios({ ruc: rucLogin, solUser, solPass, desde, hasta, diagnostico, mapaCuentas });
  if (!r.ok) return NextResponse.json({ error: r.error, diag: r.diag }, { status: r.loginError ? 401 : 502 });
  // Si SUNAT trae más recibos que lo disponible del mes, se entregan solo esos.
  let recibos = r.recibos ?? [];
  let asientos = r.asientos ?? [];
  let avisoTope: string | undefined;
  if (tope) {
    if (tope.disponibles !== null && recibos.length > tope.disponibles) {
      avisoTope = `Se entregan ${tope.disponibles} de ${recibos.length} recibos: llegaste al máximo de ${tope.tope} comprobantes del mes.`;
      recibos = recibos.slice(0, tope.disponibles);
      asientos = asientos.slice(0, tope.disponibles);
    }
    if (!diagnostico) await sumarComprobantes(tope.adminId, recibos.length);
  }
  return NextResponse.json({
    total: recibos.length,
    recibos,
    asientos,
    avisoTope,
    archivo: avisoTope ? undefined : r.archivoBase64,
    nombre: r.nombreArchivo,
    diag: r.diag,
  });
}
