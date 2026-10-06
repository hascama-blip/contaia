// Actualizar fichas con RENIEC (vía apidni): datos + foto del DNI, de una en una o en lote.
import * as db from "../lib/db.js";
import { consultarDni, fichaDesdeReniec, fotoComoArchivo } from "../lib/reniec.js";
import { adjuntarArchivo } from "./asociados.js";
import { ahoraISO } from "../lib/formato.js";

export const dniValido = (dni) => /^\d{8}$/.test(String(dni || "").replace(/\D/g, ""));
export const verificado = (a) => Boolean(a?.reniec?.verificadoAt);

/**
 * Consulta el DNI del asociado y guarda en su ficha los datos de RENIEC y la foto (si llega).
 * Con datos SIMULADOS (servidor sin token) no se modifica nada.
 * @returns {Promise<{ simulado: boolean, foto: boolean, persona: object }>}
 */
export async function actualizarDesdeReniec(a, { por = null, conFoto = true } = {}) {
  if (!dniValido(a.dni)) throw { code: "dni_invalido", message: "El DNI debe tener 8 dígitos." };
  const { persona, simulado } = await consultarDni(a.dni);
  if (simulado) return { simulado: true, foto: false, persona };
  const campos = fichaDesdeReniec(persona);
  await db.actualizarAsociado(a.id, {
    ...campos,
    reniec: { verificadoAt: ahoraISO(), fuente: persona.fuente || "apidni", por },
    actualizadoAt: ahoraISO(), actualizadoPor: por,
  });
  let foto = false;
  if (conFoto) {
    const archivo = fotoComoArchivo(persona);
    if (archivo) { await adjuntarArchivo(a.id, "foto", archivo); foto = true; }
  }
  return { simulado: false, foto, persona };
}

/**
 * Verifica muchos asociados en secuencia (2 a la vez), avisando el avance.
 * @param {object[]} lista
 * @param {{ por?: string|null, onAvance?: (e: object) => void, detener?: () => boolean }} op
 */
export async function verificarEnLote(lista, { por = null, onAvance = () => {}, detener = () => false } = {}) {
  const resumen = { total: lista.length, hechos: 0, ok: 0, conFoto: 0, errores: [], simulado: false, detenido: false };
  let i = 0;
  async function obrero() {
    while (i < lista.length) {
      if (detener()) { resumen.detenido = true; return; }
      const a = lista[i++];
      try {
        const r = await actualizarDesdeReniec(a, { por });
        if (r.simulado) { resumen.simulado = true; resumen.detenido = true; return; }
        resumen.ok++; if (r.foto) resumen.conFoto++;
      } catch (e) {
        resumen.errores.push({ id: a.id, numero: a.numero, dni: a.dni, nombre: `${a.apellidoPaterno || ""} ${a.nombres || ""}`.trim(), mensaje: e?.message || String(e) });
      } finally {
        resumen.hechos++; onAvance({ ...resumen, actual: a });
      }
    }
  }
  await Promise.all([obrero(), obrero()]);
  return resumen;
}
