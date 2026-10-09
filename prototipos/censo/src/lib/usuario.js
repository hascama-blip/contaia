// Quién está usando la página (nombre para la cabecera y para "registrado por").
// Solo se guarda el id; el nombre se resuelve cada vez que se muestra.

let conexion = null;

export function conectarUsuario() {
  if (!conexion) {
    conexion = window.claude?.use ? window.claude.use("user") : Promise.resolve(null);
  }
  return conexion;
}

export async function usuarioActual() {
  const u = await conectarUsuario();
  if (!u) return { id: null, nombre: "", puedeEscribir: null, puedeIncidencias: null };
  const [yo, puede, incid, admin] = await Promise.all([u.me().catch(() => null), u.can("data.write").catch(() => null), u.can("incidencias.write").catch(() => null), u.isOwner ? u.isOwner().catch(() => false) : false]);
  // puedeIncidencias: edición y administración siempre; el rol "seguridad" solo esto (en claude.ai no existe, equivale a puedeEscribir).
  return { id: yo?.id ?? null, nombre: yo?.name || "", rol: yo?.rol || null, puedeEscribir: puede, puedeIncidencias: incid === null ? puede : Boolean(incid || puede), esAdmin: Boolean(admin) };
}

export async function nombresDe(ids) {
  const u = await conectarUsuario();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!u || !unicos.length) return {};
  const perfiles = await u.profiles(unicos);
  return Object.fromEntries(unicos.map((id) => [id, perfiles[id]?.name || ""]));
}
