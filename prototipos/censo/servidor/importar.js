#!/usr/bin/env node
// Carga en el servidor los datos iniciales (semilla.json de importar_padron.py,
// o un respaldo exportado). Reemplaza lo que haya en esas colecciones.
//   node servidor/importar.js /ruta/semilla.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Almacen, COLECCIONES } from "./lib/almacen.js";

const DATOS = path.resolve(process.env.DATOS || path.join(path.dirname(fileURLToPath(import.meta.url)), "datos"));
const archivo = process.argv[2];
if (!archivo) { console.error("Uso: node servidor/importar.js semilla.json"); process.exit(1); }
const semilla = JSON.parse(fs.readFileSync(archivo, "utf8"));
const almacen = new Almacen(DATOS);
const conteo = Object.fromEntries(COLECCIONES.map((c) => [c, 0]));
for (const { path: p, data } of semilla) {
  const [col, id] = p.split("/");
  if (!COLECCIONES.includes(col)) continue;
  almacen.establecer(col, id, data);
  conteo[col]++;
}
almacen.vaciar();
console.log("Importado:", conteo, "→", DATOS);
