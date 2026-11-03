// Arranque del servidor Node: planificador de la tarea nocturna de alertas
// (buzón vigilado, cronograma DDJJ, vencimiento de plan). Para no arrastrar
// módulos de Node (navegador headless, fs…) a este archivo, que Next también
// compila para Edge, el planificador NO importa la tarea: la dispara por HTTP
// contra el propio servidor (POST /api/tareas/nocturna) con un token interno.
// La ruta decide si ya corrió hoy. Un cron externo puede hacer lo mismo con
// ?token=CRON_SECRET.
import { tokenInterno } from "./lib/tokenInterno";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NOCTURNA_DESACTIVADA === "1") return;
  const g = globalThis as any;
  if (g.__radarPlanificador) return;
  g.__radarPlanificador = true;

  const hora = Number(process.env.NOCTURNA_HORA ?? 3);
  const puerto = process.env.PORT || "3000";
  const tick = async () => {
    try {
      const lima = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
      if (lima.getHours() < hora) return;
      const res = await fetch(`http://127.0.0.1:${puerto}/api/tareas/nocturna`, {
        method: "POST",
        headers: { "x-cron-token": await tokenInterno() },
      });
      const txt = await res.text().catch(() => "");
      if (!/omitida/.test(txt)) console.log("[nocturna]", res.status, txt.slice(0, 300));
    } catch (e) {
      console.error("[nocturna] No se pudo disparar la tarea:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(tick, 90 * 1000);          // primer chequeo al minuto y medio de arrancar
  setInterval(tick, 20 * 60 * 1000);    // luego cada 20 minutos
}
