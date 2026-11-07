// ============================================================
//  client_secret del API SIRE: nunca viaja al navegador
// ============================================================
// Se guarda en el servidor (Cliente.credSire). Al navegador solo llega un
// marcador; cuando la pantalla lo devuelve tal cual, el servidor usa el
// guardado. Así un operador (o quien mire el navegador) no puede leerlo.
import type { Cliente, CredencialesSire } from "./types";

export const SECRETO_OCULTO = "__guardado__";

/** El secreto a usar: el que mandó la pantalla, o el guardado si llegó el marcador o vacío. */
export function resolverSecreto(enviado: unknown, guardado?: string | null): string {
  const e = typeof enviado === "string" ? enviado.trim() : "";
  if (!e || e === SECRETO_OCULTO) return (guardado ?? "").trim();
  return e;
}

export function ocultarCred<T extends Partial<CredencialesSire> | null | undefined>(c: T): T {
  if (!c) return c;
  return { ...c, clientSecret: c.clientSecret ? SECRETO_OCULTO : "" } as T;
}

/** Copia del cliente apta para el navegador (sin el client_secret real). */
export function ocultarCliente<T extends Cliente | null | undefined>(c: T): T {
  if (!c) return c;
  return { ...c, credSire: ocultarCred(c.credSire) } as T;
}
