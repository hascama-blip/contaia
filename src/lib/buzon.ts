import type { BuzonMensaje, BuzonResultado } from "./types";

// ============================================================
//  Buzón electrónico SUNAT (Control de mensajes / notificaciones)
// ============================================================
// Usa la misma credencial (Clave SOL + client_id/secret) que el SIRE.
// La API "Control de mensajes" cuelga de /v1/contribuyente/controlmsg.
// Como la documentación no es pública, el endpoint exacto se calibra con
// un MODO DIAGNÓSTICO que prueba varios candidatos.

export interface BuzonParams {
  ruc: string;
  solUser: string;
  solPass: string;
  clientId?: string;
  clientSecret?: string;
  /** Días hacia atrás a resumir (por defecto 15). */
  dias?: number;
  diagnostico?: boolean;
}

interface BuzonConfig {
  tokenUrl: string;
  scope: string;
  apiBase: string;
  listarPath: string;
  defClientId: string;
  defClientSecret: string;
}

function getConfig(): BuzonConfig {
  return {
    tokenUrl:
      process.env.SUNAT_TOKEN_URL ??
      "https://api-seguridad.sunat.gob.pe/v1/clientessol",
    scope: process.env.BUZON_SCOPE ?? "https://api.sunat.gob.pe",
    apiBase:
      process.env.BUZON_API_BASE ?? "https://api.sunat.gob.pe/v1/contribuyente/controlmsg",
    // {desde} {hasta} = fechas YYYY-MM-DD. Calibrable por entorno.
    listarPath:
      process.env.BUZON_LISTAR_PATH ??
      "/mensajes/listar?page=1&perpage=50&fechadesde={desde}&fechahasta={hasta}",
    defClientId: process.env.SUNAT_SIRE_CLIENT_ID ?? "",
    defClientSecret: process.env.SUNAT_SIRE_CLIENT_SECRET ?? "",
  };
}

function fechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function obtenerToken(
  cfg: BuzonConfig,
  ruc: string,
  solUser: string,
  solPass: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const url = `${cfg.tokenUrl}/${clientId}/oauth2/token/`;
  const body = new URLSearchParams({
    grant_type: "password",
    scope: cfg.scope,
    client_id: clientId,
    client_secret: clientSecret,
    username: `${ruc}${solUser}`,
    password: solPass,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`autenticación SUNAT (HTTP ${res.status}): ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("autenticación SUNAT sin token");
  return json.access_token;
}

// Palabras clave de los mensajes URGENTES (cobranza y valores).
const URGENTES = [
  "cobranza coactiva",
  "ejecución coactiva",
  "ejecucion coactiva",
  "resolución de ejecución",
  "resolucion de ejecucion",
  "rec ",
  "orden de pago",
  "resolución de determinación",
  "resolucion de determinacion",
  "resolución de multa",
  "resolucion de multa",
  "valor",
  "embargo",
  "medida cautelar",
];

function esUrgente(texto: string): boolean {
  const t = texto.toLowerCase();
  return URGENTES.some((k) => t.includes(k));
}

function mapearMensajes(data: any): BuzonMensaje[] {
  const arr: any[] = Array.isArray(data)
    ? data
    : data?.mensajes ?? data?.registros ?? data?.lista ?? data?.data ?? [];
  return arr.map((m, i) => {
    const asunto = String(
      m.asunto ?? m.subject ?? m.titulo ?? m.descripcion ?? m.mensaje ?? ""
    );
    const fecha = String(
      m.fechaEnvio ?? m.fecha ?? m.fechaVigencia ?? m.fechaPublica ?? m.date ?? ""
    );
    const tipo = String(m.tipoMensaje ?? m.tipo ?? m.categoria ?? "");
    return {
      id: String(m.codMensaje ?? m.id ?? m.numMensaje ?? i),
      fecha,
      asunto,
      tipo,
      urgente: esUrgente(`${asunto} ${tipo}`),
      leido: Boolean(m.indLeido ?? m.leido ?? false),
    };
  });
}

export async function consultarBuzon(params: BuzonParams): Promise<BuzonResultado> {
  const { ruc, solUser, solPass } = params;
  if (!/^\d{11}$/.test(ruc)) throw new Error("RUC inválido.");
  if (!solUser || !solPass) {
    throw new Error("Ingresa el Usuario SOL y la Clave SOL.");
  }
  const cfg = getConfig();
  const clientId = params.clientId || cfg.defClientId;
  const clientSecret = params.clientSecret || cfg.defClientSecret;
  if (!clientId || !clientSecret) {
    throw new Error("Faltan client_id y client_secret de la app SUNAT.");
  }

  const dias = params.dias && params.dias > 0 ? params.dias : 15;
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * 24 * 60 * 60 * 1000);

  const token = await obtenerToken(cfg, ruc, solUser, solPass, clientId, clientSecret);
  const diag: { pasos: any[] } = { pasos: [] };

  // En diagnóstico: probar varios endpoints candidatos.
  if (params.diagnostico) {
    const q = "?numpag=1&perpag=20&page=1&perPage=20";
    const candidatos = [
      "",
      "/mensajes",
      "/listamensajes" + q,
      "/consultamensajes" + q,
      "/mensajes/listamensajes" + q,
      "/mensajes/consultamensajes" + q,
      "/mensajes/web/listamensajes" + q,
      "/mensajes/masivo/listamensajes" + q,
      "/mensaje/web/listamensajes" + q,
      "/mensajeria/web/listamensajes" + q,
      "/avisos/web/listaavisos" + q,
      "/mensajes/web/consultamensajes" + q,
      "/mensajes/listamensajenotificacion" + q,
      "/notificaciones/web/listanotificaciones" + q,
      "/mensajes/web/mensajes" + q,
    ];
    for (const path of candidatos) {
      const url = `${cfg.apiBase}${path
        .replace("{desde}", fechaISO(desde))
        .replace("{hasta}", fechaISO(hasta))}`;
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        const txt = await res.text();
        diag.pasos.push({
          paso: `probe ${path}`,
          httpStatus: res.status,
          ok: res.ok,
          respuesta: txt.slice(0, 350),
        });
      } catch (e) {
        diag.pasos.push({ paso: `probe ${path}`, ok: false, respuesta: String(e) });
      }
    }
    return { mensajes: [], urgentes: [], diag };
  }

  const url = `${cfg.apiBase}${cfg.listarPath
    .replace("{desde}", fechaISO(desde))
    .replace("{hasta}", fechaISO(hasta))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`buzón SUNAT (HTTP ${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({}));
  const mensajes = mapearMensajes(data);
  const urgentes = mensajes.filter((m) => m.urgente);
  return { mensajes, urgentes };
}
