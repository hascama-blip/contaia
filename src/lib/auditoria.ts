import { getCurrentUser, studioId } from "./auth";
import { registrarAccion, getCliente } from "./db";

/**
 * Registra una acción en la bitácora del estudio. Resuelve solo el usuario
 * actual, su estudio y (si se da clienteId) el nombre de la empresa.
 *
 * NUNCA lanza: si algo falla, la acción original NO debe romperse por la
 * auditoría. Llamar con await pero sin propagar errores.
 */
export async function logAccion(data: {
  area: string;
  accion: string;
  clienteId?: string;
  clienteNombre?: string;
  detalle?: string;
}): Promise<void> {
  try {
    const u = await getCurrentUser();
    if (!u) return; // sin sesión no hay a quién atribuir
    let clienteNombre = data.clienteNombre;
    if (!clienteNombre && data.clienteId) {
      const c = await getCliente(data.clienteId).catch(() => null);
      clienteNombre = c?.razonSocial;
    }
    await registrarAccion({
      studioId: studioId(u),
      usuarioId: u.id,
      usuarioNombre: u.nombre,
      rol: u.rol === "operador" ? "operador" : "admin",
      area: data.area,
      accion: data.accion,
      clienteId: data.clienteId,
      clienteNombre,
      detalle: data.detalle,
    });
  } catch {
    /* la auditoría nunca rompe la acción principal */
  }
}
