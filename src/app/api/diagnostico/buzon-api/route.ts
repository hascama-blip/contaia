import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// PRUEBA AISLADA (solo supremo): ¿se puede leer el buzón por API oficial (HTTP,
// sin navegador)? Saca el token OAuth (igual que el SIRE, sin navegador) y prueba
// llamar un endpoint con ese Bearer. NO toca el buzón/SIRE de producción.
const TOKEN_BASE = "https://api-seguridad.sunat.gob.pe/v1/clientessol";

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
  const scope = String(b.scope ?? "https://api-sire.sunat.gob.pe").trim();
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
    pasos.push({
      paso: "1) Token OAuth",
      scopeSolicitado: scope,
      httpStatus: res.status,
      scopeConcedido: json.scope ?? "(no informado)",
      tokenType: json.token_type ?? "-",
      expiresIn: json.expires_in ?? "-",
      resultado: json.access_token ? "✅ token recibido" : txt.slice(0, 400),
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
