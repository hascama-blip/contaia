// Aplicar la actualización con fichas del libro de padrón: las mismas decisiones que la
// revisión (src/lib/actualizarFichas.js), pero guardando. Los traspasos usan transferirStand,
// igual que «Registrar venta o traspaso»: el dueño anterior pasa al historial del stand.
import * as db from "../lib/db.js";
import { procesarFichas, copiarEstado, nombreDocumento, yaAdjunta } from "../lib/actualizarFichas.js";
import { standsPorAsociado } from "../lib/padron.js";
import { ahoraISO, hoy } from "../lib/formato.js";
import { transferirStand } from "./stands.js";
import { subirDocumentos } from "./documentos.js";

/** "data:image/jpeg;base64,…" → File (para subirlo como documento). */
function archivoDesdeDataURL(dataURL, nombre) {
  const [cab, b64] = dataURL.split(",");
  const tipo = /data:([^;]+)/.exec(cab)?.[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], `${nombre}.${tipo === "image/png" ? "png" : "jpg"}`, { type: tipo });
}

/**
 * @param {{fichas, fechaDocumento}} lote
 * @param {{asociados, stands}} datos   lo que muestra el portal ahora
 * @param {{ por, motivo, onAvance }} op
 */
export async function aplicarFichas(lote, datos, { por, motivo, onAvance } = {}) {
  const estado = copiarEstado(datos);
  // Tras cada cambio se relee del servidor lo que se tocó: el paso siguiente decide con datos al día.
  const refrescarAsociado = async (id) => {
    if (!id) return;
    const a = await db.leerAsociado(id);
    const i = estado.asociados.findIndex((x) => x.id === id);
    if (a && i >= 0) estado.asociados[i] = a; else if (a) estado.asociados.push(a);
  };
  const refrescarStand = async (codigo) => {
    const s = await db.leerStand(codigo);
    const i = estado.stands.findIndex((x) => x.codigo === codigo);
    if (s && i >= 0) estado.stands[i] = { ...s, codigo: s.codigo || codigo }; else if (s) estado.stands.push({ ...s, codigo: s.codigo || codigo });
  };
  const ops = {
    crear: async (datosFicha) => {
      const id = await db.nuevoId("asociados");
      await db.guardarAsociado(id, datosFicha);
      await refrescarAsociado(id);
      return id;
    },
    actualizar: async (id, parcial) => {
      await db.actualizarAsociado(id, { ...parcial, actualizadoAt: ahoraISO(), actualizadoPor: por || null });
      await refrescarAsociado(id);
    },
    crearStand: async (codigo, datosStand) => { await db.guardarStand(codigo, datosStand); await refrescarStand(codigo); },
    actualizarStand: async (codigo, parcial) => { await db.actualizarStand(codigo, parcial); await refrescarStand(codigo); },
    traspasar: async (codigo, tr) => {
      const antes = estado.stands.find((s) => s.codigo === codigo);
      const anteriorId = antes?.propietarioId || null;
      const delAnterior = anteriorId ? standsPorAsociado(estado.stands).get(anteriorId) || [] : [];
      const anteriorSale = Boolean(anteriorId && delAnterior.every((s) => s.codigo === codigo));
      const numeroAntes = estado.asociados.find((a) => a.id === tr.nuevoId)?.numero || "";
      await transferirStand(codigo, { modo: "existente", nuevoId: tr.nuevoId, fecha: tr.fecha, motivo: tr.motivo, documento: tr.documento, observacion: tr.observacion, quitarInquilino: false },
        { asociados: estado.asociados, stands: estado.stands, mapaStands: standsPorAsociado(estado.stands), por });
      await refrescarStand(codigo);
      await refrescarAsociado(anteriorId);
      await refrescarAsociado(tr.nuevoId);
      const numeroDespues = estado.asociados.find((a) => a.id === tr.nuevoId)?.numero || "";
      return { hereda: numeroDespues && numeroDespues !== numeroAntes ? numeroDespues : null, anteriorSale };
    },
    adjuntar: async (id, fotos) => {
      const a = estado.asociados.find((x) => x.id === id);
      const actuales = a?.documentos || [];
      const nuevas = fotos.filter((f) => !yaAdjunta(a, f));
      if (!nuevas.length) return 0;
      const r = await subirDocumentos(id, nuevas.map((f) => archivoDesdeDataURL(f.dataURL, nombreDocumento(f))), actuales, { por });
      if (r.errores.length) throw new Error(r.errores.join(" "));
      await refrescarAsociado(id);
      return r.subidos;
    },
  };
  return procesarFichas(lote, estado, { ops, hoyIso: hoy().iso, ahora: ahoraISO(), motivo, por, onAvance });
}
