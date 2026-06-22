"use client";

// Recuerda la Clave SOL (y usuario) por empresa SOLO durante la sesión del
// navegador (sessionStorage: se borra al cerrar la pestaña). NUNCA se manda a
// la base de datos. Así cada módulo pide la Clave SOL una sola vez.

const k = (clienteId: string) => `solpass:${clienteId}`;
const kUser = (clienteId: string) => `soluser:${clienteId}`;

export function getSolPass(clienteId: string): string {
  if (typeof window === "undefined" || !clienteId) return "";
  try { return sessionStorage.getItem(k(clienteId)) || ""; } catch { return ""; }
}
export function setSolPass(clienteId: string, pass: string) {
  if (typeof window === "undefined" || !clienteId) return;
  try { if (pass) sessionStorage.setItem(k(clienteId), pass); } catch { /* */ }
}
export function getSolUser(clienteId: string, fallback = ""): string {
  if (typeof window === "undefined" || !clienteId) return fallback;
  try { return sessionStorage.getItem(kUser(clienteId)) || fallback; } catch { return fallback; }
}
export function setSolUser(clienteId: string, user: string) {
  if (typeof window === "undefined" || !clienteId) return;
  try { if (user) sessionStorage.setItem(kUser(clienteId), user); } catch { /* */ }
}
