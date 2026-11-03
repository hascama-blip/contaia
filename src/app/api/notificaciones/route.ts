import { NextResponse } from "next/server";
import { requireUser, studioId, planDelEstudio, diasParaVencerPlan, esSupremo } from "@/lib/auth";
import { getRecordatorios, listClientes, listAvisos, getUserById } from "@/lib/db";
import { PLAN_LABEL } from "@/lib/modulos";
import { proximosVencimientos } from "@/lib/cronogramaSunat";

export const runtime = "nodejs";

// Panel "Notificaciones" del Inicio (todas las cuentas):
//  - plan: cuál es y cuántos días faltan para que venza;
//  - buzón: seguimientos con plazo (vencidos / por vencer) programados en Consultas;
//  - declaraciones: empresas próximas a vencer según el cronograma SUNAT (último dígito del RUC);
//  - avisos: informativos publicados por el supremo + alertas automáticas del estudio.
export async function GET() {
  const user = await requireUser();
  const sid = studioId(user);
  const admin = user.parentId ? await getUserById(user.parentId) : user;
  const [recordatorios, clientes, avisosSupremo] = await Promise.all([
    getRecordatorios(sid).catch(() => []),
    listClientes(sid).catch(() => []),
    listAvisos(true).catch(() => []),
  ]);

  const plan = await planDelEstudio(user);
  const diasPlan = esSupremo(user) ? null : diasParaVencerPlan(admin);
  const buzon = {
    vencidos: recordatorios.filter((r) => r.vencido).length,
    porVencer: recordatorios.filter((r) => !r.vencido).length,
    items: recordatorios
      .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite))
      .slice(0, 6)
      .map((r) => ({ clienteId: r.clienteId, razonSocial: r.razonSocial, asunto: r.asunto, fechaLimite: r.fechaLimite, vencido: r.vencido, comentario: r.comentario })),
  };
  const declaraciones = proximosVencimientos(clientes.map((c) => ({ id: c.id, ruc: c.ruc, razonSocial: c.razonSocial })), 15).slice(0, 8);

  // Alertas automáticas del estudio (se recalculan en cada carga).
  const autos: { tipo: "info" | "alerta"; titulo: string; texto: string; href?: string }[] = [];
  const sinVerificar = clientes.filter((c) => !c.sunat).length;
  if (sinVerificar > 0) autos.push({ tipo: "alerta", titulo: `${sinVerificar} empresa(s) sin verificar en SUNAT`, texto: "Verifica el RUC para habilitar el diagnóstico.", href: "/clientes" });
  const noHabidos = clientes.filter((c) => /no habido|no hallado/i.test(c.sunat?.condicion ?? "")).length;
  if (noHabidos > 0) autos.push({ tipo: "alerta", titulo: `${noHabidos} empresa(s) con condición NO HABIDO / NO HALLADO`, texto: "Regulariza el domicilio fiscal para evitar contingencias.", href: "/clientes" });
  const sinDiag = clientes.filter((c) => c.sunat && !c.diagnostico).length;
  if (sinDiag > 0) autos.push({ tipo: "info", titulo: `${sinDiag} empresa(s) sin diagnóstico`, texto: "Ejecuta el Reporte analítico para obtener su score de riesgo.", href: "/clientes" });
  if (clientes.length === 0) autos.push({ tipo: "info", titulo: "Aún no tienes empresas registradas", texto: "Crea la primera para empezar a trabajar.", href: "/clientes/nuevo" });

  return NextResponse.json({
    plan: { id: plan, nombre: PLAN_LABEL[plan], vence: admin?.planVence ?? null, dias: diasPlan },
    buzon,
    declaraciones,
    avisos: avisosSupremo.map((a) => ({ id: a.id, titulo: a.titulo, texto: a.texto, at: a.at })),
    autos,
    actualizado: new Date().toISOString(),
  });
}
