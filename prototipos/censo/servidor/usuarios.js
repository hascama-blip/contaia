#!/usr/bin/env node
// Manejo de usuarios desde la terminal del servidor.
//   node servidor/usuarios.js crear   <usuario> "<Nombre Apellido>" <clave> [admin|edicion|lectura]
//   node servidor/usuarios.js listar
//   node servidor/usuarios.js clave   <usuario> <clave-nueva>
//   node servidor/usuarios.js rol     <usuario> <admin|edicion|lectura>
//   node servidor/usuarios.js borrar  <usuario>
// (DATOS=/var/censo si los datos no están en servidor/datos)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Usuarios } from "./lib/sesiones.js";

const DATOS = path.resolve(process.env.DATOS || path.join(path.dirname(fileURLToPath(import.meta.url)), "datos"));
const u = new Usuarios(DATOS);
const [accion, ...a] = process.argv.slice(2);
try {
  if (accion === "crear") { const r = u.crear({ usuario: a[0], nombre: a[1], clave: a[2], rol: a[3] || (u.lista.length ? "edicion" : "admin") }); console.log("Creado:", r); }
  else if (accion === "listar") console.table(u.lista.map((x) => u.publico(x)));
  else if (accion === "clave") { const x = u.porUsuario(a[0]); if (!x) throw { message: "No existe." }; u.cambiarClave(x.id, a[1]); console.log("Clave cambiada."); }
  else if (accion === "rol") { const x = u.porUsuario(a[0]); if (!x) throw { message: "No existe." }; u.cambiarRol(x.id, a[1]); console.log("Rol cambiado."); }
  else if (accion === "borrar") { const x = u.porUsuario(a[0]); if (!x) throw { message: "No existe." }; u.borrar(x.id); console.log("Borrado."); }
  else { console.log("Uso: crear | listar | clave | rol | borrar (ver cabecera del archivo)"); process.exit(1); }
} catch (e) { console.error("Error:", e.message); process.exit(1); }
