// Token de sesión firmado (HMAC-SHA256). SOLO usa Web Crypto, sin Node ni
// next/headers, para que también funcione en el middleware (edge runtime).

export const SESSION_COOKIE = "rt_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 días (segundos)

const SECRET =
  process.env.AUTH_SECRET || "radar-tributario-dev-secret-cambiar-en-produccion";

const enc = (s: string) => new TextEncoder().encode(s);

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function strToB64Url(s: string): string {
  return bytesToB64Url(enc(s));
}
function b64UrlToStr(b64: string): string {
  const pad = b64.replace(/-/g, "+").replace(/_/g, "/");
  return atob(pad + "===".slice((pad.length + 3) % 4));
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc(data));
  return bytesToB64Url(new Uint8Array(sig));
}

/** Compara dos strings en tiempo (aprox.) constante. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Crea un token firmado con el id de usuario y vencimiento. */
export async function createSessionToken(uid: string): Promise<string> {
  const payload = strToB64Url(
    JSON.stringify({ uid, exp: Date.now() + SESSION_MAX_AGE * 1000 })
  );
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

/** Verifica el token y devuelve el id de usuario, o null si es inválido/venció. */
export async function verifySessionToken(token: string): Promise<string | null> {
  const [payload, sig] = (token || "").split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(payload);
  if (!safeEqual(sig, expected)) return null;
  try {
    const obj = JSON.parse(b64UrlToStr(payload)) as { uid?: string; exp?: number };
    if (!obj.uid || !obj.exp || obj.exp < Date.now()) return null;
    return obj.uid;
  } catch {
    return null;
  }
}
