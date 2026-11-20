import type { BuzonMensaje, VigilanciaBuzon } from "./types";

// ============================================================
//  Qué se avisa del buzón vigilado (puro: sin red ni store)
// ============================================================
//  · UN SOLO aviso por empresa y noche: la notificación más reciente (con su PDF) y, si
//    llegaron más, la lista de las otras.
//  · Primera lectura tras activar la vigilancia: solo la ÚLTIMA que llegó; las anteriores
//    quedan como vistas y no se envían (antes salían todas: más de 300 mensajes en una noche).
//  · Lo que tenga más de MAX_DIAS_AVISO_BUZON días nunca se avisa (es pasado).

/** Un mensaje del buzón con más días que esto ya no se avisa: solo se marca como visto. */
export const MAX_DIAS_AVISO_BUZON = Math.max(1, Number(process.env.BUZON_ALERTA_MAX_DIAS ?? "10") || 10);

/** Fecha del buzón ("02/11/2026 19:53:00" o ISO) → milisegundos; 0 si no se entiende. */
export function tiempoBuzon(fecha: string): number {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(fecha ?? "");
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime();
  const t = Date.parse(fecha ?? "");
  return Number.isFinite(t) ? t : 0;
}

export interface SeleccionBuzon {
  /** Mensajes que no estaban vistos (todos pasan a vistos, se avisen o no). */
  nuevos: BuzonMensaje[];
  /** Lo que entra en el aviso, del más reciente al más antiguo ([] = no se envía nada). */
  avisar: BuzonMensaje[];
  /** false = es la primera lectura de esta vigilancia. */
  baseHecha: boolean;
}

export function elegirAvisosBuzon(mensajes: BuzonMensaje[], v: Pick<VigilanciaBuzon, "vistos" | "base" | "ultimaAlerta" | "ultimoChequeo" | "ultimoError">, ahora = Date.now()): SeleccionBuzon {
  const vistos = new Set(v.vistos ?? []);
  const nuevos = mensajes.filter((m) => m.id && !vistos.has(m.id));
  // ¿Ya hubo una primera lectura? (o la vigilancia se activó con el buzón ya consultado)
  const baseHecha = v.base === true || vistos.size > 0 || Boolean(v.ultimaAlerta) || Boolean(v.ultimoChequeo && !v.ultimoError);
  const limite = ahora - MAX_DIAS_AVISO_BUZON * 86400000;
  const recientes = nuevos.slice().sort((a, b) => tiempoBuzon(b.fecha) - tiempoBuzon(a.fecha));
  const avisar = baseHecha ? recientes.filter((m) => { const t = tiempoBuzon(m.fecha); return !t || t >= limite; }) : recientes.slice(0, 1);
  return { nuevos, avisar, baseHecha };
}

/** Título y texto del ÚNICO aviso de la empresa. */
export function textoAvisoBuzon(empresa: { razonSocial: string; ruc: string }, sel: SeleccionBuzon, conPdf: boolean): { titulo: string; texto: string } {
  const m = sel.avisar[0], otros = sel.avisar.slice(1);
  const peor = sel.avisar.some((x) => x.nivel === "peligroso") ? "peligroso" : sel.avisar.some((x) => x.nivel === "urgente") ? "urgente" : "otro";
  const nivel = peor === "peligroso" ? "⚠️ PELIGROSO · " : peor === "urgente" ? "🔴 URGENTE · " : "";
  const corto = (s: string) => (s.length > 110 ? `${s.slice(0, 107)}…` : s);
  const pdfNota = conPdf ? "" : " (El PDF se podrá abrir desde la web.)";
  const quien = `${empresa.razonSocial} (RUC ${empresa.ruc})`;
  if (!sel.baseHecha) {
    return {
      titulo: `${nivel}${quien}: última notificación SUNAT del buzón`,
      texto: `${m.fecha ? `Del ${m.fecha}: ` : ""}${m.asunto}.${pdfNota}\nVigilancia activada: las notificaciones anteriores no se envían; desde ahora solo te avisaremos de las nuevas.`,
    };
  }
  if (!otros.length) {
    return { titulo: `${nivel}${quien} recibió una notificación SUNAT`, texto: `${m.fecha ? `El ${m.fecha}: ` : ""}${m.asunto}. Debe ser atendida.${pdfNota}` };
  }
  return {
    titulo: `${nivel}${quien} recibió ${sel.avisar.length} notificaciones SUNAT`,
    texto: `La más reciente${m.fecha ? `, del ${m.fecha}` : ""}: ${m.asunto}.${pdfNota}\nAdemás:\n${otros.slice(0, 5).map((x) => `• ${x.fecha ? `${x.fecha}: ` : ""}${corto(x.asunto)}`).join("\n")}${otros.length > 5 ? `\n• y ${otros.length - 5} más` : ""}\nDeben ser atendidas.`,
  };
}
