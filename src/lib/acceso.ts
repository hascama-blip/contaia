// ============================================================
//  Control de acceso por MÓDULO en el servidor (APIs y páginas)
// ============================================================
// Antes los planes solo se revisaban al dibujar las páginas: una cuenta podía
// llamar directo a la API de un módulo de pago. Ahora cada ruta de un módulo
// llama a `bloqueoModulo(...)` al inicio: si el plan del estudio (o los
// utilitarios habilitados por el supremo) no incluye NINGUNO de los módulos
// indicados, responde 403. El supremo tiene todos.

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import type { Usuario } from "./types";
import { getCurrentUser, modulosDelEstudio, esSupremo } from "./auth";

/** ¿El usuario tiene al menos uno de los módulos? */
export async function tieneModulo(u: Usuario | null, ...keys: string[]): Promise<boolean> {
  if (!u) return false;
  if (esSupremo(u)) return true;
  const mods = await modulosDelEstudio(u);
  return keys.some((k) => mods.has(k));
}

/** Para rutas API: null si puede seguir; si no, la respuesta 401/403 a devolver. */
export async function bloqueoModulo(...keys: string[]): Promise<NextResponse | null> {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (await tieneModulo(u, ...keys)) return null;
  return NextResponse.json(
    { error: "Este módulo no está incluido en tu plan. Actívalo desde «Adquirir módulos».", sinPlan: true },
    { status: 403 },
  );
}

/** Para rutas API exclusivas del supremo. */
export async function bloqueoSupremo(): Promise<NextResponse | null> {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return esSupremo(u) ? null : NextResponse.json({ error: "Solo el administrador de la plataforma." }, { status: 403 });
}

/** Para páginas: si no tiene el módulo, lo lleva a los planes. */
export async function exigirModuloPagina(...keys: string[]): Promise<Usuario> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (!(await tieneModulo(u, ...keys))) redirect("/planes");
  return u!;
}

/** Dashboard ISSOSOMA: solo el supremo y los correos de ISSOSOMA_EMAILS. */
export function puedeVerIssosoma(u: Usuario | null): boolean {
  if (!u) return false;
  if (esSupremo(u)) return true;
  const lista = (process.env.ISSOSOMA_EMAILS || "").toLowerCase().split(/[,;\s]+/).filter(Boolean);
  return lista.includes(u.email.toLowerCase());
}

/** Modo diagnóstico (respuesta cruda de SUNAT, sin consumir cupo): SOLO el
 *  supremo. Para cualquier otro usuario se ignora el pedido. Se llama justo
 *  después de leer el cuerpo de la petición. */
export async function limpiarDiagnostico(body: any): Promise<void> {
  if (!body || typeof body !== "object" || !body.diagnostico) return;
  if (!esSupremo(await getCurrentUser())) body.diagnostico = false;
}

/** Estudio dueño de las memorias (cuentas aprendidas) del usuario actual.
 *  undefined = supremo → memoria global heredada. */
export async function estudioMemoria(): Promise<string | undefined> {
  const u = await getCurrentUser();
  if (!u || esSupremo(u)) return undefined;
  return u.parentId ?? u.id;
}
