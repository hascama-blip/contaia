// Autenticación (lado servidor Node): hash de contraseña + usuario actual.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { getUserById, getClienteDeUsuario } from "./db";
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

/** Exige sesión Y rol admin (para acciones reservadas al dueño del estudio). */
export async function requireAdmin(): Promise<Usuario | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  return esAdmin(u) ? u : null;
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
