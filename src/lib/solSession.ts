"use client";

// Recuerda la Clave SOL (y usuario) por empresa SOLO durante la sesión del
// navegador (sessionStorage: se borra al cerrar la pestaña). NUNCA se manda a
// la base de datos. Así cada módulo pide la Clave SOL una sola vez.

const k = (clienteId: string) => `solpass:${clienteId}`;
const kUser = (clienteId: string) => `soluser:${clienteId}`;

// Empresas de SIMULACIÓN (id "demo-…"): la clave figura como cargada; el
// servidor nunca la usa (responde con datos ficticios, sin llamar a SUNAT).
const esDemo = (id: string) => id.startsWith("demo-");

export function getSolPass(clienteId: string): string {
  if (typeof window === "undefined" || !clienteId) return "";
  if (esDemo(clienteId)) return "demo";
  try { return sessionStorage.getItem(k(clienteId)) || ""; } catch { return ""; }
}
export function setSolPass(clienteId: string, pass: string) {
  if (typeof window === "undefined" || !clienteId) return;
  try { if (pass) sessionStorage.setItem(k(clienteId), pass); } catch { /* */ }
}
export function getSolUser(clienteId: string, fallback = ""): string {
  if (typeof window === "undefined" || !clienteId) return fallback;
  if (esDemo(clienteId)) return fallback || "DEMO2026";
  try { return sessionStorage.getItem(kUser(clienteId)) || fallback; } catch { return fallback; }
}
export function setSolUser(clienteId: string, user: string) {
  if (typeof window === "undefined" || !clienteId) return;
  try { if (user) sessionStorage.setItem(kUser(clienteId), user); } catch { /* */ }
}

/** Borra TODAS las Claves SOL (y usuarios) recordadas en esta pestaña. Se llama al
 *  cerrar sesión, al iniciar otra y cuando la sesión cambia: si no, en un equipo
 *  compartido la siguiente persona podría leer las claves de las empresas del anterior. */
export function borrarClavesSol() {
  if (typeof window === "undefined") return;
  try {
    const quitar: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith("solpass:") || key.startsWith("soluser:"))) quitar.push(key);
    }
    for (const key of quitar) sessionStorage.removeItem(key);
  } catch { /* sin storage */ }
}
