import { promises as fs } from "fs";
import path from "path";
import { zipSync, unzipSync } from "fflate";
import { DATA_DIR, STORE_PATH, UPLOADS_DIR, BACKUPS_DIR } from "./db";

// ============================================================
//  Backup y restauración de la "base de datos" del proyecto
// ============================================================
// La BD es data/store.json (clientes, usuarios, config, auditoría) + los
// archivos subidos en data/uploads (PDFs del buzón, documentos). Además,
// db.ts guarda un snapshot diario del store en data/backups (últimos 14).

/** ZIP completo: store.json + uploads/** + snapshots diarios. */
export async function crearBackupZip(): Promise<Buffer> {
  const archivos: Record<string, Uint8Array> = {};
  try {
    archivos["store.json"] = new Uint8Array(await fs.readFile(STORE_PATH));
  } catch {
    archivos["store.json"] = new TextEncoder().encode('{"clientes":[]}');
  }
  await agregarCarpeta(archivos, UPLOADS_DIR, "uploads");
  await agregarCarpeta(archivos, BACKUPS_DIR, "backups");
  return Buffer.from(zipSync(archivos, { level: 6 }));
}

async function agregarCarpeta(destino: Record<string, Uint8Array>, dir: string, rel: string): Promise<void> {
  let entries: any[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // carpeta no existe aún
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) await agregarCarpeta(destino, abs, r);
    else {
      try {
        destino[r] = new Uint8Array(await fs.readFile(abs));
      } catch {}
    }
  }
}

/** Solo los datos (store.json) como texto, para el backup rápido. */
export async function leerStoreRaw(): Promise<string> {
  try {
    return await fs.readFile(STORE_PATH, "utf-8");
  } catch {
    return '{"clientes":[]}';
  }
}

export interface ResultadoRestauracion {
  clientes: number;
  usuarios: number;
  archivosRestaurados: number;
}

/**
 * Restaura desde un backup: acepta un store.json suelto o el ZIP completo
 * (restaura store + uploads). Antes de pisar nada, guarda una copia de
 * seguridad del store actual en backups/store-antes-restaurar-<ts>.json.
 */
export async function restaurarBackup(buf: Buffer, nombre: string): Promise<ResultadoRestauracion> {
  const esZip = buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b;

  let storeRaw: string;
  let archivosRestaurados = 0;
  let zipEntries: Record<string, Uint8Array> | null = null;

  if (esZip) {
    zipEntries = unzipSync(new Uint8Array(buf));
    const key = Object.keys(zipEntries).find((k) => k === "store.json" || k.endsWith("/store.json"));
    if (!key) throw new Error("El ZIP no contiene store.json.");
    storeRaw = new TextDecoder().decode(zipEntries[key]);
  } else {
    storeRaw = buf.toString("utf-8");
  }

  // Validación: debe ser el JSON del store (con el array de clientes).
  let parsed: any;
  try {
    parsed = JSON.parse(storeRaw);
  } catch {
    throw new Error(`"${nombre}" no es un JSON válido.`);
  }
  if (!parsed || !Array.isArray(parsed.clientes)) {
    throw new Error("El archivo no parece un backup del proyecto (falta la lista de clientes).");
  }

  // Copia de seguridad del estado ACTUAL antes de pisarlo.
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
  try {
    const actual = await fs.readFile(STORE_PATH, "utf-8");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await fs.writeFile(path.join(BACKUPS_DIR, `store-antes-restaurar-${ts}.json`), actual, "utf-8");
  } catch {}

  // Restaurar el store.
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(parsed, null, 2), "utf-8");

  // Restaurar uploads (solo si vino el ZIP completo).
  if (zipEntries) {
    for (const [k, data] of Object.entries(zipEntries)) {
      if (!k.startsWith("uploads/") || k.endsWith("/")) continue;
      const destino = path.join(UPLOADS_DIR, k.slice("uploads/".length));
      // Evita rutas maliciosas fuera de uploads (zip-slip).
      if (!path.resolve(destino).startsWith(path.resolve(UPLOADS_DIR))) continue;
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(destino, Buffer.from(data));
      archivosRestaurados++;
    }
  }

  return {
    clientes: parsed.clientes.length,
    usuarios: Array.isArray(parsed.users) ? parsed.users.length : 0,
    archivosRestaurados,
  };
}
