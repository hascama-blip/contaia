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

const tieneNumero = (a) => { const n = String(a?.numero || "").trim(); return !!n && !/^s\/n/i.test(n); };
const nombreDe = (a) => `${a.apellidoPaterno || ""} ${a.apellidoMaterno || ""}`.trim() + (a.nombres ? `, ${a.nombres}` : "");
const PATRON_TRASPASO = /\s*Figura en la ficha del stand (\d{4}), que hoy está a nombre de N° ([^:]+): verificar traspaso\.?/;

/**
 * Regla acordada con la directiva: las ventas anotadas en el libro de padrón se registran solas.
 * Caso: una ficha sin N° (el comprador) trae la nota del importador "Figura en la ficha del stand
 * XXXX, que hoy está a nombre de N° YYY: verificar traspaso" y la ficha del dueño actual (el
 * vendedor) tiene la nota adhesiva del libro con "VENDIÓ". Entonces: el stand pasa al comprador,
 * el vendedor queda en el historial como Transferido y, si se queda sin stands, el comprador
 * hereda su N° de padrón (no se crea un N° nuevo). Idempotente: aplicado una vez, la nota se
 * reemplaza por el registro del traspaso y el stand ya no está a nombre del vendedor.
 * @returns {string[]} descripción de cada traspaso aplicado
 */
export function traspasosAnotadosEnElLibro(almacen) {
  const hechos = [];
  const hoy = new Date().toISOString(), fechaHoy = hoy.slice(0, 10), fechaTxt = fechaHoy.split("-").reverse().join("/");
  const asociados = almacen.listar("asociados");
  const porId = new Map(asociados.map((d) => [d.id, d.data]));
  for (const { id: compradorId, data: comprador } of asociados) {
    const m = PATRON_TRASPASO.exec(comprador?.observaciones || ""); if (!m) continue;
    const codigo = m[1]; const stand = almacen.obtener("stands", codigo);
    if (!stand?.data?.propietarioId || stand.data.propietarioId === compradorId) continue;
    const vendedorId = stand.data.propietarioId, vendedor = porId.get(vendedorId); if (!vendedor) continue;
    const notaLibro = (String(vendedor.observaciones || "").match(/'([^']*VENDI[^']*)'/i) || [])[1]; if (!notaLibro) continue;
    const standsVendedor = almacen.listar("stands").filter((s) => s.data?.propietarioId === vendedorId);
    const saleDelPadron = standsVendedor.every((s) => s.id === codigo);
    const hereda = saleDelPadron && tieneNumero(vendedor) && !tieneNumero(comprador) ? String(vendedor.numero).trim() : null;
    const detalle = `Traspaso tomado de la nota del libro de padrón: '${notaLibro}'. Fecha real de la venta no registrada; se asentó el ${fechaTxt}.`;
    // 1) El stand pasa al comprador; el vendedor queda en el historial del stand.
    almacen.actualizar("stands", codigo, { propietarioId: compradorId, propietarioDesde: null, historial: [...(stand.data.historial || []), { asociadoId: vendedorId, nombre: nombreDe(vendedor), dni: vendedor.dni || "", desde: stand.data.propietarioDesde || vendedor.fechaIngreso || null, hasta: fechaHoy, motivo: "Compraventa", documento: "", observacion: detalle, por: null, registradoAt: hoy }] });
    // 2) El vendedor: Transferido si ya no tiene stands; cede su N° si corresponde.
    const cambiosVendedor = { actualizadoAt: hoy, revisar: false }; // la nota "VENDIÓ" del libro ya quedó atendida
    if (saleDelPadron) cambiosVendedor.estado = "transferido";
    if (hereda) { cambiosVendedor.numero = ""; cambiosVendedor.numeroHistorial = [...(vendedor.numeroHistorial || []), { numero: hereda, hasta: fechaHoy, cedidoA: compradorId, cedidoANombre: nombreDe(comprador), stand: codigo, motivo: "Compraventa", por: null, registradoAt: hoy }]; }
    almacen.actualizar("asociados", vendedorId, cambiosVendedor);
    // 3) El comprador: recibe el N° (si hereda), queda activo y la nota pasa a ser el registro del traspaso.
    const observaciones = String(comprador.observaciones || "").replace(PATRON_TRASPASO, "").replace(/^Revisar \(transcripción del libro\): /, "").trim();
    const cambiosComprador = { estado: "activo", revisar: false, actualizadoAt: hoy,
      observaciones: [observaciones, `Traspaso del stand ${codigo} registrado el ${fechaTxt} según la nota del libro ('${notaLibro}')${hereda ? `; heredó el N° ${hereda} de ${nombreDe(vendedor)}` : ""}.`].filter(Boolean).join(" ") };
    if (hereda) Object.assign(cambiosComprador, { numero: hereda, numeroDesde: fechaHoy, numeroHeredadoDe: { asociadoId: vendedorId, nombre: nombreDe(vendedor), dni: vendedor.dni || "", stand: codigo, fecha: fechaHoy } });
    almacen.actualizar("asociados", compradorId, cambiosComprador);
    porId.set(vendedorId, { ...vendedor, ...cambiosVendedor }); porId.set(compradorId, { ...comprador, ...cambiosComprador });
    hechos.push(`stand ${codigo}: ${nombreDe(vendedor)} → ${nombreDe(comprador)}${hereda ? ` (hereda N° ${hereda})` : ""}`);
  }
  return hechos;
}

export function aplicarMigraciones(almacen) {
  const r = { fichasVerificadasPorReniec: fichasVerificadasPorReniec(almacen), traspasos: traspasosAnotadosEnElLibro(almacen) };
  if (r.fichasVerificadasPorReniec) console.log(`Migración: ${r.fichasVerificadasPorReniec} ficha(s) verificadas con RENIEC pasaron a estado "verificado".`);
  for (const t of r.traspasos) console.log(`Migración: traspaso anotado en el libro aplicado · ${t}`);
  if (r.fichasVerificadasPorReniec || r.traspasos.length) almacen.vaciar();
  return r;
}
