import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// PRUEBA AISLADA (solo supremo): ¿se puede leer el buzón por API oficial (HTTP,
// sin navegador)? Saca el token OAuth (igual que el SIRE, sin navegador) y prueba
// llamar un endpoint con ese Bearer. NO toca el buzón/SIRE de producción.
const TOKEN_BASE = "https://api-seguridad.sunat.gob.pe/v1/clientessol";

// Decodifica el payload del JWT (solo base64, sin verificar firma): ahí SUNAT
// escribe los recursos/scopes CONCEDIDOS — nos dice la URL real de cada API.
function decodeJwt(tok: string): any {
  try {
    const b64 = tok.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    // userdata a veces viene como string JSON anidado: lo abrimos.
    if (typeof json.userdata === "string") {
      try { json.userdata = JSON.parse(json.userdata); } catch {}
    }
    return json;
  } catch {
    return null;
  }
}

// Pide un token con el scope dado. Devuelve { token, status, detalle }.
async function pedirToken(
  clientId: string, clientSecret: string, ruc: string, solUser: string, solPass: string, scope: string
): Promise<{ token: string; status: number; detalle: string }> {
  const res = await fetch(`${TOKEN_BASE}/${clientId}/oauth2/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      scope,
      client_id: clientId,
      client_secret: clientSecret,
      username: `${ruc}${solUser}`,
      password: solPass,
    }),
  });
  const txt = await res.text();
  let json: any = {};
  try { json = JSON.parse(txt); } catch {}
  return { token: json.access_token ?? "", status: res.status, detalle: json.access_token ? "ok" : txt.slice(0, 300) };
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!esSupremo(user)) {
    return NextResponse.json({ error: "Solo el usuario supremo puede usar esta prueba." }, { status: 403 });
  }

  const b = await req.json().catch(() => ({} as any));
  const ruc = String(b.ruc ?? "").trim();
  const solUser = String(b.solUser ?? "").trim();
  const solPass = String(b.solPass ?? "");
  const clientId = String(b.clientId ?? "").trim();
  const clientSecret = String(b.clientSecret ?? "").trim();
  const preset = String(b.preset ?? "").trim(); // "controlmsg" = auto-probar API de mensajes
  // Para Control de mensajes el scope es el gateway general api.sunat.gob.pe.
  // OJO: en el preset se FUERZA ese scope (aunque el formulario mande el del SIRE).
  const scope =
    preset === "controlmsg"
      ? "https://api.sunat.gob.pe"
      : String(b.scope ?? "https://api-sire.sunat.gob.pe").trim();
  const endpoint = String(b.endpoint ?? "").trim();
  const metodo = String(b.metodo ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const cuerpo = String(b.cuerpo ?? "");

  if (!ruc || !solUser || !solPass || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Faltan credenciales (RUC, usuario/clave SOL, client_id, client_secret)." },
      { status: 400 }
    );
  }

  const pasos: any[] = [];

  // 1) Token OAuth por HTTP puro (sin navegador) — igual que el SIRE.
  let token = "";
  try {
    const url = `${TOKEN_BASE}/${clientId}/oauth2/token/`;
    const body = new URLSearchParams({
      grant_type: "password",
      scope,
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
    const txt = await res.text();
    let json: any = {};
    try { json = JSON.parse(txt); } catch {}
    // Decodificamos el JWT: su payload dice QUÉ recursos concede SUNAT (la URL
    // real de cada API habilitada en el credencial).
    const jwt = json.access_token ? decodeJwt(json.access_token) : null;
    pasos.push({
      paso: "1) Token OAuth",
      scopeSolicitado: scope,
      httpStatus: res.status,
      scopeConcedido: json.scope ?? "(no informado)",
      tokenType: json.token_type ?? "-",
      expiresIn: json.expires_in ?? "-",
      resultado: json.access_token ? "✅ token recibido" : txt.slice(0, 400),
      jwtPayload: jwt ? JSON.stringify(jwt).slice(0, 3000) : "(no se pudo decodificar)",
    });
    if (!res.ok || !json.access_token) {
      return NextResponse.json({
        ok: false,
        conclusion: "No se obtuvo el token. Revisa credenciales y que el credential tenga habilitado ese scope/servicio.",
        pasos,
      });
    }
    token = json.access_token;
  } catch (e: any) {
    return NextResponse.json({ ok: false, conclusion: "Error de red pidiendo el token.", pasos: [...pasos, { error: String(e?.message ?? e) }] });
  }

  // PRESET: auto-probar la API oficial "Control de mensajes" (/v1/contribuyente/controlmsg).
  // Prueba varios paths candidatos con el token y reporta cuál responde.
  if (preset === "controlmsg") {
    const BASE = "https://api.sunat.gob.pe/v1/contribuyente/controlmsg";
    const p = "page=1&numPag=1&perPag=20&tipoMsj=2&codCarpeta=00";
    const candidatos = [
      // Rutas planas
      `${BASE}/mensajes?${p}`,
      `${BASE}/bandeja?${p}`,
      `${BASE}/listamensajes?${p}`,
      `${BASE}/consulta/mensajes?${p}`,
      // Con el RUC en el path (patrón usado por otras APIs SUNAT)
      `${BASE}/${ruc}/mensajes?${p}`,
      `${BASE}/contribuyentes/${ruc}/mensajes?${p}`,
      `https://api.sunat.gob.pe/v1/contribuyente/contribuyentes/${ruc}/mensajes?${p}`,
      // Cantidad de no leídos (endpoint chico típico)
      `${BASE}/mensajes/cantidad`,
      `${BASE}/cantidadmensajes`,
      // Visor del portal con Bearer (por descartar)
      `https://ww1.sunat.gob.pe/ol-ti-itvisornoti/visor/listNotiMenPag?tipoMsj=2&codCarpeta=00&codEtiqueta=&page=1&des_asunto=&codMensaje=&tipoOrden=NADA`,
    ];

    // HOSTS ALTERNOS (patrón SIRE: cada servicio tiene su host y su scope, p.ej.
    // api-sire.sunat.gob.pe). Probamos hosts candidatos con SU propio scope.
    const hosts = [
      "https://api-controlmsg.sunat.gob.pe",
      "https://api-mensajes.sunat.gob.pe",
      "https://api-buzon.sunat.gob.pe",
      "https://api-cpe.sunat.gob.pe",
    ];
    for (const h of hosts) {
      try {
        const t = await pedirToken(clientId, clientSecret, ruc, solUser, solPass, h);
        if (!t.token) {
          pasos.push({ host: h, paso: "token con scope del host", httpStatus: t.status, resultado: t.detalle });
          continue;
        }
        const jwtH = decodeJwt(t.token);
        const u = `${h}/v1/contribuyente/controlmsg/mensajes?numPag=1&perPag=20`;
        const r = await fetch(u, { headers: { Authorization: `Bearer ${t.token}`, Accept: "application/json" } });
        const tx = await r.text();
        pasos.push({
          host: h,
          paso: "token ✅ + endpoint",
          endpoint: u,
          httpStatus: r.status,
          resultado: tx.slice(0, 500),
          jwtPayload: jwtH ? JSON.stringify(jwtH).slice(0, 1500) : "-",
        });
      } catch (e: any) {
        pasos.push({ host: h, error: String(e?.message ?? e).slice(0, 200) });
      }
    }
    for (const u of candidatos) {
      try {
        const res = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
        const txt = await res.text();
        pasos.push({
          endpoint: u.replace(/\?.*/, ""),
          httpStatus: res.status,
          contentType: res.headers.get("content-type") ?? "",
          // 404 = no existe ese path; 400 = existe pero faltan params; 200 = ¡bingo!
          resultado: txt.slice(0, 500),
        });
      } catch (e: any) {
        pasos.push({ endpoint: u.replace(/\?.*/, ""), error: String(e?.message ?? e) });
      }
    }
    const hit = pasos.find((x) => x.httpStatus === 200 || x.httpStatus === 400);
    return NextResponse.json({
      ok: true,
      conclusion: hit
        ? `Endpoint prometedor: ${hit.endpoint} (HTTP ${hit.httpStatus}). 200=funciona; 400=existe pero hay que ajustar parámetros. Pásame la respuesta.`
        : "Ningún candidato respondió 200/400 (todos 404/401). Hace falta el path exacto del manual de SUNAT. Pero el token con scope api.sunat.gob.pe ¿salió? (mira el paso 1).",
      pasos,
    });
  }

  // 2) Llamar el endpoint indicado con el Bearer (si se indicó uno).
  if (endpoint) {
    try {
      const init: RequestInit = {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      };
      if (metodo === "POST" && cuerpo) {
        (init.headers as any)["Content-Type"] = cuerpo.trim().startsWith("{")
          ? "application/json"
          : "application/x-www-form-urlencoded";
        init.body = cuerpo;
      }
      const res = await fetch(endpoint, init);
      const txt = await res.text();
      pasos.push({
        paso: "2) Endpoint CON token",
        url: endpoint,
        metodo,
        httpStatus: res.status,
        contentType: res.headers.get("content-type") ?? "",
        resultado: txt.slice(0, 4000),
      });

      // 2b) Mismo endpoint SIN token: si da lo MISMO que con token, el Bearer no
      // está autenticando (el endpoint necesita la sesión SOL/cookies del navegador).
      const sinInit: RequestInit = { method: metodo, headers: { Accept: "application/json" } };
      if (metodo === "POST" && cuerpo) {
        (sinInit.headers as any)["Content-Type"] = cuerpo.trim().startsWith("{")
          ? "application/json"
          : "application/x-www-form-urlencoded";
        sinInit.body = cuerpo;
      }
      const resSin = await fetch(endpoint, sinInit);
      const txtSin = await resSin.text();
      pasos.push({
        paso: "2b) Mismo endpoint SIN token (comparación)",
        httpStatus: resSin.status,
        contentType: resSin.headers.get("content-type") ?? "",
        resultado: txtSin.slice(0, 2000),
        nota: "Si esto es igual al paso 2, el token NO está autenticando (haría falta la sesión SOL del navegador).",
      });
    } catch (e: any) {
      pasos.push({ paso: "2) Endpoint con token", url: endpoint, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json({
    ok: true,
    conclusion: endpoint
      ? "Revisa el paso 2: si el endpoint devolvió 200 con datos JSON, el buzón por API es viable."
      : "Token OK. Ahora pega un endpoint de mensajes para probarlo con este token.",
    pasos,
  });
}
