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

/**
 * Empresa por id SOLO si pertenece al usuario de la sesión (para API routes):
 * devuelve null si no hay sesión o la empresa no es del usuario.
 */
export async function getClienteAutorizado(id: string): Promise<Cliente | null> {
  const u = await getCurrentUser();
  if (!u) return null;
  return getClienteDeUsuario(id, u.id);
}
