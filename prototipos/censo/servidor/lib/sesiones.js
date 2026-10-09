// Usuarios (clave con scrypt) y sesiones (cookie firmada con HMAC).
// Roles: admin (todo, incluye usuarios) · edicion (registra y edita) · lectura (solo mira).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const COOKIE = "censo_sesion";
export const ROLES = ["admin", "edicion", "lectura", "seguridad"]; // seguridad: consulta y solo registra incidencias
const DURACION_MS = 1000 * 60 * 60 * 12; // 12 horas de sesión

export class Usuarios {
  constructor(dir) {
    this.ruta = path.join(dir, "usuarios.json");
    this.secretoRuta = path.join(dir, "secreto");
    fs.mkdirSync(dir, { recursive: true });
    this.#leer();
    this.secreto = process.env.CENSO_SECRETO || this.#secretoEnDisco();
  }

  #leer() {
    try { this.lista = JSON.parse(fs.readFileSync(this.ruta, "utf8")); this.mtime = fs.statSync(this.ruta).mtimeMs; } catch { this.lista = []; this.mtime = 0; }
  }

  /** Relee usuarios.json si lo cambió otro proceso (p. ej. usuarios.js desde la terminal). */
  recargarSiCambio() {
    let m = 0; try { m = fs.statSync(this.ruta).mtimeMs; } catch { /* no existe aún */ }
    if (m !== this.mtime) this.#leer();
  }

  #secretoEnDisco() {
    try { return fs.readFileSync(this.secretoRuta, "utf8").trim(); } catch {
      const s = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(this.secretoRuta, s, { mode: 0o600 });
      return s;
    }
  }

  #guardar() {
    const tmp = this.ruta + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.lista, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.ruta);
    this.mtime = fs.statSync(this.ruta).mtimeMs;
  }

  static #hash(clave, sal) {
    return crypto.scryptSync(clave, sal, 64).toString("hex");
  }

  porUsuario(usuario) {
    this.recargarSiCambio();
    return this.lista.find((u) => u.usuario.toLowerCase() === String(usuario || "").trim().toLowerCase()) || null;
  }
  porId(id) { this.recargarSiCambio(); return this.lista.find((u) => u.id === id) || null; }

  crear({ usuario, nombre, clave, rol = "edicion" }) {
    usuario = String(usuario || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw { status: 400, message: "El usuario debe tener de 3 a 30 letras, números, punto, guion o guion bajo." };
    if (this.porUsuario(usuario)) throw { status: 409, message: "Ese usuario ya existe." };
    if (String(clave || "").length < 8) throw { status: 400, message: "La clave debe tener al menos 8 caracteres." };
    if (!ROLES.includes(rol)) throw { status: 400, message: "Rol inválido." };
    const sal = crypto.randomBytes(16).toString("hex");
    const u = { id: "u_" + crypto.randomBytes(8).toString("hex"), usuario, nombre: String(nombre || usuario).trim(), rol, sal, hash: Usuarios.#hash(clave, sal), creadoAt: new Date().toISOString() };
    this.lista.push(u);
    this.#guardar();
    return this.publico(u);
  }

  cambiarClave(id, clave) {
    const u = this.porId(id);
    if (!u) throw { status: 404, message: "Usuario no encontrado." };
    if (String(clave || "").length < 8) throw { status: 400, message: "La clave debe tener al menos 8 caracteres." };
    u.sal = crypto.randomBytes(16).toString("hex");
    u.hash = Usuarios.#hash(clave, u.sal);
    this.#guardar();
  }

  cambiarRol(id, rol) {
    const u = this.porId(id);
    if (!u) throw { status: 404, message: "Usuario no encontrado." };
    if (!ROLES.includes(rol)) throw { status: 400, message: "Rol inválido." };
    u.rol = rol;
    this.#guardar();
  }

  borrar(id) {
    const i = this.lista.findIndex((u) => u.id === id);
    if (i < 0) throw { status: 404, message: "Usuario no encontrado." };
    if (this.lista[i].rol === "admin" && this.lista.filter((u) => u.rol === "admin").length === 1) {
      throw { status: 400, message: "No se puede borrar al único administrador." };
    }
    this.lista.splice(i, 1);
    this.#guardar();
  }

  /** Comprueba usuario y clave en tiempo constante. */
  verificar(usuario, clave) {
    const u = this.porUsuario(usuario);
    const hash = Usuarios.#hash(String(clave || ""), u?.sal || "x");
    const ok = u && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(u.hash));
    return ok ? u : null;
  }

  publico(u) {
    return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
  }

  // ---- Sesión (cookie "id.vence.firma") ----
  #firmar(texto) {
    return crypto.createHmac("sha256", this.secreto).update(texto).digest("base64url");
  }

  emitirCookie(u, seguro) {
    const vence = Date.now() + DURACION_MS;
    const cuerpo = `${u.id}.${vence}`;
    const valor = `${cuerpo}.${this.#firmar(cuerpo)}`;
    return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACION_MS / 1000}${seguro ? "; Secure" : ""}`;
  }

  cookieSalida() {
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  /** Usuario de la cookie, o null. */
  deCookie(valor) {
    const partes = String(valor || "").split(".");
    if (partes.length !== 3) return null;
    const [id, vence, firma] = partes;
    const esperada = this.#firmar(`${id}.${vence}`);
    if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
    if (Number(vence) < Date.now()) return null;
    return this.porId(id);
  }
}

export const puedeEscribir = (u) => Boolean(u && (u.rol === "admin" || u.rol === "edicion"));
/** Registrar y actualizar incidencias: edición, administración y el personal de seguridad. */
export const puedeIncidencias = (u) => puedeEscribir(u) || Boolean(u && u.rol === "seguridad");
export const esAdmin = (u) => Boolean(u && u.rol === "admin");
