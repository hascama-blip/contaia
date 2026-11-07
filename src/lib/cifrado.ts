import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Cifrado simétrico (AES-256-GCM) de los secretos guardados en el servidor: la
// Clave SOL de la vigilancia del buzón, el client_secret del API SIRE y las
// claves de integraciones. La llave vive SOLO en el entorno del servidor
// (VIGILANCIA_KEY; si no está, se deriva de AUTH_SECRET). Sin la llave, el
// archivo de datos y sus copias no revelan esos secretos.

let llaveMemo: { base: string; key: Buffer } | null = null;
function llave(): Buffer {
  const base = process.env.VIGILANCIA_KEY || process.env.AUTH_SECRET || "radar-tributario-dev-secret-cambiar-en-produccion";
  if (llaveMemo?.base !== base) llaveMemo = { base, key: createHash("sha256").update(`vigilancia:${base}`).digest() };
  return llaveMemo.key;
}

/** ¿El texto ya viene cifrado con `cifrar`? */
export function esCifrado(v: unknown): v is string {
  return typeof v === "string" && /^v1:[\w-]+:[\w-]+:[\w-]*$/.test(v);
}

/** Devuelve "v1:<iv>:<tag>:<cifrado>" en base64url. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave(), iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

/** Descifra lo que produjo `cifrar`. Lanza si la llave no coincide o el dato fue alterado. */
export function descifrar(dato: string): string {
  const [v, ivB, tagB, encB] = dato.split(":");
  if (v !== "v1" || !ivB || !tagB || !encB) throw new Error("Formato cifrado inválido.");
  const d = createDecipheriv("aes-256-gcm", llave(), Buffer.from(ivB, "base64url"));
  d.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([d.update(Buffer.from(encB, "base64url")), d.final()]).toString("utf8");
}
