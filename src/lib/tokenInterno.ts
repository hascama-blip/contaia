// Token interno para que el planificador (instrumentation) llame a la tarea
// nocturna por HTTP sin exponer un secreto nuevo. Usa Web Crypto (funciona en
// Node y en Edge, así el archivo de instrumentación no arrastra módulos Node).
export async function tokenInterno(): Promise<string> {
  const base = process.env.CRON_SECRET || process.env.AUTH_SECRET || "radar-tributario-dev-secret-cambiar-en-produccion";
  const data = new TextEncoder().encode(`nocturna-interna:${base}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
