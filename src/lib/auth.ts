// Autenticación (lado servidor Node): hash de contraseña + usuario actual.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { getUserById, getClienteDeUsuario, getUserByEmail, createUser, updateUserById, eliminarTodosLosUsuarios } from "./db";
import { verifySessionToken, SESSION_COOKIE } from "./authToken";
import type { Usuario, Cliente } from "./types";

export { SESSION_COOKIE } from "./authToken";

/** Usuario sin el hash de contraseña (para mandar al cliente/UI). */
export type UsuarioPublico = Omit<Usuario, "passHash">;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const h = scryptSync(pw, salt, 64);
  const hb = Buffer.from(hash, "hex");
  return h.length === hb.length && timingSafeEqual(h, hb);
}

export function publicUser(u: Usuario): UsuarioPublico {
  const { passHash, ...rest } = u;
  return rest;
}

// Credenciales del usuario supremo (dueño de la plataforma). Se pueden
// sobreescribir por entorno; si no, usa los valores iniciales acordados.
const SUPREMO_EMAIL = (process.env.SUPREMO_EMAIL ?? "dascama@gmail.com").trim().toLowerCase();
const SUPREMO_PASSWORD = process.env.SUPREMO_PASSWORD ?? "D2n6a0d92000@";
const SUPREMO_NOMBRE = process.env.SUPREMO_NOMBRE ?? "Administrador supremo";

/** Garantiza la cuenta supremo (idempotente y AUTO-REPARADORA). Se llama al
 *  entrar a /login, /register y al panel del supremo. Si la cuenta no existe la
 *  crea; si existe pero no es supremo, no está aprobada o su contraseña no
 *  coincide con la configurada, la reconcilia (rol + estado + contraseña). */
export async function ensureSupremo(): Promise<void> {
  const existente = await getUserByEmail(SUPREMO_EMAIL);
  if (!existente) {
    await createUser({
      nombre: SUPREMO_NOMBRE,
      email: SUPREMO_EMAIL,
      passHash: hashPassword(SUPREMO_PASSWORD),
      rol: "supremo",
      estado: "aprobado",
    });
    return;
  }
  const patch: Record<string, unknown> = {};
  if (existente.rol !== "supremo") patch.rol = "supremo";
  if (existente.estado !== "aprobado") patch.estado = "aprobado";
  if (existente.parentId) patch.parentId = undefined;
  // Si la contraseña configurada no abre la cuenta, la reponemos.
  if (!verifyPassword(SUPREMO_PASSWORD, existente.passHash)) {
    patch.passHash = hashPassword(SUPREMO_PASSWORD);
  }
  if (Object.keys(patch).length > 0) await updateUserById(existente.id, patch);
}

/** Borra TODAS las cuentas y recrea el usuario supremo desde cero. Devuelve
 *  cuántas cuentas se eliminaron. Acción destructiva (solo el supremo). */
export async function resetUsuarios(): Promise<number> {
  const n = await eliminarTodosLosUsuarios();
  await ensureSupremo(); // recrea el supremo fresco
  return n;
}

/** Usuario de la sesión actual (o null si no hay sesión válida). */
export async function getCurrentUser(): Promise<Usuario | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const uid = await verifySessionToken(token);
  if (!uid) return null;
  return getUserById(uid);
}

/** Exige sesión: si no hay, redirige a /login. */
export async function requireUser(): Promise<Usuario> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

/** ¿El usuario es admin (dueño del estudio)? Los que tienen parentId son operadores. */
export function esAdmin(u: Usuario | null | undefined): boolean {
  return Boolean(u) && !u!.parentId && u!.rol !== "operador";
}

/** Id del ESTUDIO al que pertenece el usuario (el admin). Define qué empresas ve. */
export function studioId(u: Usuario): string {
  return u.parentId ?? u.id;
}

/** ¿Es el usuario supremo (dueño de la plataforma)? */
export function esSupremo(u: Usuario | null | undefined): boolean {
  return Boolean(u) && u!.rol === "supremo";
}

/** ¿Puede ingresar a la plataforma? El supremo siempre; un operador si su
 *  estudio está aprobado; un admin si su estado es aprobado (o antiguo). */
export function puedeIngresar(u: Usuario, parent?: Usuario | null): boolean {
  if (esSupremo(u)) return true;
  const ok = (e?: Usuario["estado"]) => e === undefined || e === "aprobado";
  if (u.parentId) return ok(parent?.estado); // operador: depende de su admin
  return ok(u.estado); // admin/estudio
}

/** Exige sesión Y rol admin (para acciones reservadas al dueño del estudio). */
export async function requireAdmin(): Promise<Usuario | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  return esAdmin(u) ? u : null;
}

/** Exige sesión Y rol supremo. Redirige a inicio si no lo es. */
export async function requireSupremo(): Promise<Usuario> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (!esSupremo(u)) redirect("/");
  return u;
}

/**
 * Empresa por id SOLO si pertenece al ESTUDIO del usuario (admin u operador):
 * devuelve null si no hay sesión o la empresa no es del estudio.
 */
export async function getClienteAutorizado(id: string): Promise<Cliente | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  return getClienteDeUsuario(id, studioId(u));
}
