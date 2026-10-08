// Ajustes de datos que se aplican una vez al arrancar (idempotentes: si no hay nada
// que cambiar, no tocan nada). Así una regla nueva alcanza a los datos ya cargados
// sin que la directiva tenga que importar ni ejecutar nada.

/**
 * Regla: toda ficha cuyos datos ya se confirmaron con RENIEC queda con estado
 * "verificado" (lo que falte en la ficha física se muestra como observación).
 * Las fichas con discrepancia de apellido no se tocan: hay que revisar el DNI.
 * @returns {number} fichas actualizadas
 */
export function fichasVerificadasPorReniec(almacen) {
  let n = 0;
  for (const { id, data: a } of almacen.listar("asociados")) {
    if (!a?.reniec?.verificadoAt || a.reniec.discrepancia || a.censo?.estado === "verificado") continue;
    almacen.actualizar("asociados", id, { censo: { ...(a.censo || {}), estado: "verificado", fecha: String(a.reniec.verificadoAt).slice(0, 10), por: a.censo?.por || null, fuente: "reniec" }, actualizadoAt: new Date().toISOString() });
    n++;
  }
  return n;
}

export function aplicarMigraciones(almacen) {
  const r = { fichasVerificadasPorReniec: fichasVerificadasPorReniec(almacen) };
  if (r.fichasVerificadasPorReniec) { almacen.vaciar(); console.log(`Migración: ${r.fichasVerificadasPorReniec} ficha(s) verificadas con RENIEC pasaron a estado "verificado".`); }
  return r;
}
