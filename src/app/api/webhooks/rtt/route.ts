import { NextRequest, NextResponse } from "next/server";
import { getRttConfig, guardarArchivosRTTPorRuc, registrarWebhookRTT, guardarReporteRentasPorRuc } from "@/lib/db";

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
    await registrarWebhookRTT({ resultado: "secreto inválido (401)" }).catch(() => {});
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ct = (req.headers.get("content-type") || "").toLowerCase();
  let ruc = "";
  let from = "";
  let recipiente = "";   // destinatario completo (para distinguir RTT vs RENTAS)
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
      recipiente = destinatario;
      from = String(form.get("from") || "");
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
      from = String(body.from || "");
      recipiente = rcptHeader || String(body.to || body.recipient || "");
      ruc = extraerRuc(recipiente) || extraerRuc(String(body.subject || ""));
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
      await registrarWebhookRTT({ resultado: `content-type no soportado (${ct.slice(0, 40)})`, from }).catch(() => {});
      return NextResponse.json({ error: "content-type no soportado" }, { status: 415 });
    }
  } catch (e: any) {
    await registrarWebhookRTT({ resultado: "error parseando el correo", from }).catch(() => {});
    return NextResponse.json({ error: e?.message ?? "error parseando el correo" }, { status: 400 });
  }

  if (!/^\d{11}$/.test(ruc)) {
    await registrarWebhookRTT({ ruc, tienePdf: !!pdf, tieneXml: !!xml, resultado: "correo recibido, pero SIN RUC en el destinatario (+RUC…@)", from }).catch(() => {});
    return NextResponse.json({ error: "sin RUC en el destinatario (+RUC…@)" }, { status: 400 });
  }
  if (!pdf && !xml) {
    await registrarWebhookRTT({ ruc, resultado: "correo recibido, pero SIN adjunto PDF/XML", from }).catch(() => {});
    return NextResponse.json({ error: "correo sin PDF/XML" }, { status: 422 });
  }

  // ¿Es el Reporte de Rentas y Retenciones (sub-address +RENTAS…)? Se guarda y
  // PARSEA aparte. Si no, es el RTT (PDF/XML por RUC) de siempre.
  const esRentas = /RENTAS/i.test(recipiente);
  if (esRentas) {
    if (!pdf) {
      await registrarWebhookRTT({ ruc, resultado: "rentas: correo recibido pero SIN PDF", from }).catch(() => {});
      return NextResponse.json({ error: "rentas sin PDF" }, { status: 422 });
    }
    const sr = await guardarReporteRentasPorRuc(ruc, pdf);
    if (!sr) {
      await registrarWebhookRTT({ ruc, tienePdf: true, resultado: "rentas: OK pero sin solicitud en proceso para ese RUC", from }).catch(() => {});
      return NextResponse.json({ error: `rentas: sin solicitud en proceso para ${ruc}` }, { status: 404 });
    }
    await registrarWebhookRTT({ ruc, tienePdf: true, resultado: "OK: reporte de rentas guardado y parseado", from }).catch(() => {});
    return NextResponse.json({ ok: true, tipo: "rentas", estado: sr.estado });
  }

  const sol = await guardarArchivosRTTPorRuc(ruc, { pdf, xml });
  if (!sol) {
    await registrarWebhookRTT({ ruc, tienePdf: !!pdf, tieneXml: !!xml, resultado: "correo recibido OK, pero no había solicitud en proceso para ese RUC", from }).catch(() => {});
    return NextResponse.json({ error: `sin solicitud en proceso para el RUC ${ruc}` }, { status: 404 });
  }
  await registrarWebhookRTT({ ruc, tienePdf: !!pdf, tieneXml: !!xml, resultado: "OK: archivo guardado y solicitud marcada como lista", from }).catch(() => {});
  return NextResponse.json({ ok: true, id: sol.id, estado: sol.estado });
}

// Extrae el RUC del sub-address: reportes+RUC20123456789@dominio
function extraerRuc(s: string): string {
  const m = String(s || "").match(/\+RUC(\d{11})@/i) || String(s || "").match(/\bRUC(\d{11})\b/i) || String(s || "").match(/\b(\d{11})\b/);
  return m ? m[1] : "";
}
