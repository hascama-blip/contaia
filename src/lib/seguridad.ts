// ============================================================
//  Revisión de la configuración de seguridad del servidor
// ============================================================
// Solo lee variables de entorno (sin módulos de Node), así la puede usar
// también el arranque (instrumentation). El panel del supremo la muestra.

export interface AvisoSeguridad { nivel: "critico" | "advertencia"; texto: string }

export function revisarConfiguracion(): AvisoSeguridad[] {
  const e = (k: string) => (process.env[k] ?? "").trim();
  const out: AvisoSeguridad[] = [];
  const auth = e("AUTH_SECRET");
  if (!auth) out.push({ nivel: "critico", texto: "Falta AUTH_SECRET: las sesiones se firman con una clave pública del código y cualquiera podría fabricar una. Agrégala al .env (64 caracteres al azar)." });
  else if (auth.length < 32) out.push({ nivel: "critico", texto: "AUTH_SECRET es muy corta (menos de 32 caracteres). Usa una de 64 caracteres al azar." });
  if (!e("VIGILANCIA_KEY")) out.push({ nivel: "advertencia", texto: "Falta VIGILANCIA_KEY: las Claves SOL de la vigilancia se cifran con AUTH_SECRET. Si algún día cambias AUTH_SECRET, se pierden. Agrega una clave propia." });
  if (!e("SUPREMO_PASSWORD")) out.push({ nivel: "advertencia", texto: "Falta SUPREMO_PASSWORD en el .env." });
  if (!e("APP_URL")) out.push({ nivel: "advertencia", texto: "Falta APP_URL (dirección pública de la web): la usan los pagos, los avisos y el informe en PDF." });
  const ip = e("IP_PUBLICA");
  if (ip && ip !== "sin-ip.invalid") out.push({ nivel: "advertencia", texto: `IP_PUBLICA=${ip} está activa: la web también responde por http:// sin cifrar en esa IP. Quítala del .env si ya no la usas.` });
  if (process.env.NODE_ENV !== "production") out.push({ nivel: "advertencia", texto: "El servidor no corre en modo producción (NODE_ENV)." });
  return out;
}
