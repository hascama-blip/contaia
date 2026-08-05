import { NextRequest, NextResponse } from "next/server";
import { getRttConfig, guardarArchivosRTTPorRuc } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

// PASO 5-6 de la trazabilidad: el proveedor de correo entrante (SendGrid Inbound
// Parse / Mailgun Routes / Cloudflare Email Worker) hace POST aquí con el correo
// de SUNAT ya parseado. Se valida el secreto, se extrae el RUC del sub-address
// del destinatario, se guardan los adjuntos PDF/XML y la solicitud pasa a "listo".
//
// Es PÚBLICO (lo llama el proveedor, no un usuario): la seguridad es el secreto
// compartido (X-Webhook-Secret o ?secret=), NO la sesión.
export async function POST(req: NextRequest) {
  const { secret } = await getRttConfig();
  const url = new URL(req.url);
  const enviado = req.headers.get("x-webhook-secret") || url.searchParams.get("secret") || "";
  if (!secret || enviado !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ct = (req.headers.get("content-type") || "").toLowerCase();
  let ruc = "";
  let pdf: Buffer | undefined;
  let xml: Buffer | undefined;

  // Destinatario (para sacar el RUC del sub-address): varía por proveedor.
  const rcptHeader = req.headers.get("x-rcpt-to") || url.searchParams.get("to") || "";

  try {
    if (ct.includes("multipart/form-data")) {
      // SendGrid Inbound Parse / Mailgun Routes: campos + archivos adjuntos.
      const form = await req.formData();
      const destinatario =
        rcptHeader ||
        String(form.get("to") || form.get("recipient") || form.get("envelope") || "");
      ruc = extraerRuc(destinatario) || extraerRuc(String(form.get("subject") || ""));
      for (const [, value] of form.entries()) {
        if (value instanceof File) {
          const nombre = (value.name || "").toLowerCase();
          const tct = (value.type || "").toLowerCase();
          const buf = Buffer.from(await value.arrayBuffer());
          if (tct.includes("pdf") || nombre.endsWith(".pdf")) pdf = buf;
          else if (tct.includes("xml") || nombre.endsWith(".xml")) xml = buf;
        }
      }
    } else if (ct.includes("application/json")) {
      // Formato JSON con adjuntos en base64 (proveedor propio / worker custom).
      const body = await req.json().catch(() => ({}));
      ruc = extraerRuc(rcptHeader || String(body.to || body.recipient || "")) || extraerRuc(String(body.subject || ""));
      const atts: any[] = Array.isArray(body.attachments) ? body.attachments : [];
      for (const a of atts) {
        const nombre = String(a.filename || a.name || "").toLowerCase();
        const tct = String(a.contentType || a.type || "").toLowerCase();
        const data = a.content || a.data;
        if (!data) continue;
        const buf = Buffer.from(String(data), "base64");
        if (tct.includes("pdf") || nombre.endsWith(".pdf")) pdf = buf;
        else if (tct.includes("xml") || nombre.endsWith(".xml")) xml = buf;
      }
    } else {
      return NextResponse.json({ error: "content-type no soportado" }, { status: 415 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error parseando el correo" }, { status: 400 });
  }

  if (!/^\d{11}$/.test(ruc)) return NextResponse.json({ error: "sin RUC en el destinatario (+RUC…@)" }, { status: 400 });
  if (!pdf && !xml) return NextResponse.json({ error: "correo sin PDF/XML" }, { status: 422 });

  const sol = await guardarArchivosRTTPorRuc(ruc, { pdf, xml });
  if (!sol) return NextResponse.json({ error: `sin solicitud en proceso para el RUC ${ruc}` }, { status: 404 });
  return NextResponse.json({ ok: true, id: sol.id, estado: sol.estado });
}

// Extrae el RUC del sub-address: reportes+RUC20123456789@dominio
function extraerRuc(s: string): string {
  const m = String(s || "").match(/\+RUC(\d{11})@/i) || String(s || "").match(/\bRUC(\d{11})\b/i) || String(s || "").match(/\b(\d{11})\b/);
  return m ? m[1] : "";
}
