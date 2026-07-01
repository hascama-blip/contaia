import { getCurrentUser, studioId } from "./auth";
import { estadoUsos, consumirUso } from "./db";

// Cupo del MÓDULO GRATIS: 3 consultas por estudio cada 7 días. Al agotarse,
// hay que esperar la renovación (o adquirir un plan = ilimitado).

/** Verifica si el estudio puede hacer una consulta gratis (sin consumir). */
export async function chequearUso(): Promise<
  | { ok: true; adminId: string; ilimitado: boolean; restantes: number }
  | { ok: false; mensaje: string; renuevaAt: string | null }
> {
  const u = await getCurrentUser();
  if (!u) return { ok: false, mensaje: "Sesión no válida.", renuevaAt: null };
  const adminId = studioId(u);
  const st = await estadoUsos(adminId);
  if (st.ilimitado) return { ok: true, adminId, ilimitado: true, restantes: 999 };
  if (st.restantes <= 0) {
    const cuando = st.renuevaAt ? new Date(st.renuevaAt).toLocaleDateString("es-PE") : "en unos días";
    return {
      ok: false,
      renuevaAt: st.renuevaAt,
      mensaje: `Agotaste tus 3 consultas gratis. Se renuevan el ${cuando}, o adquiere un plan para consultas ilimitadas.`,
    };
  }
  return { ok: true, adminId, ilimitado: false, restantes: st.restantes };
}

/** Consume 1 uso del cupo gratis del estudio (los planes de paga no consumen). */
export async function registrarUso(adminId: string, ilimitado: boolean): Promise<void> {
  if (ilimitado) return;
  await consumirUso(adminId).catch(() => {});
}
