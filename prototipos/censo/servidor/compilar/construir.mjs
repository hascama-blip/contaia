// Genera ../../dist/app.<hash>.js (minificado, con mapa de código) y dist/manifest.json.
// El servidor, si encuentra dist/manifest.json, sirve ese archivo en lugar de los 50 módulos.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../..");
const DIST = path.join(RAIZ, "dist");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const r = await build({
  entryPoints: [path.join(AQUI, "entrada.js")],
  bundle: true, minify: true, sourcemap: true, format: "esm", target: ["es2022"], platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: path.join(DIST, "app.js"),
  legalComments: "none", logLevel: "warning",
});
const codigo = fs.readFileSync(path.join(DIST, "app.js"));
const hash = crypto.createHash("sha256").update(codigo).digest("hex").slice(0, 10);
fs.renameSync(path.join(DIST, "app.js"), path.join(DIST, `app.${hash}.js`));
fs.renameSync(path.join(DIST, "app.js.map"), path.join(DIST, `app.${hash}.js.map`));
fs.writeFileSync(path.join(DIST, `app.${hash}.js`), codigo.toString("utf8").replace("//# sourceMappingURL=app.js.map", `//# sourceMappingURL=app.${hash}.js.map`));
fs.writeFileSync(path.join(DIST, "manifest.json"), JSON.stringify({ app: `/dist/app.${hash}.js`, bytes: codigo.length, en: new Date().toISOString() }, null, 1));
console.log(`dist/app.${hash}.js → ${(codigo.length / 1024).toFixed(0)} KB`);
