import { NextRequest, NextResponse } from "next/server";
import { ASOC_COOKIE, cookieValida, guardarMedia, MEDIA_MAX } from "@/lib/asociacion";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST → sube una imagen o video (requiere cookie de edición). Devuelve la URL.
export async function POST(req: NextRequest) {
  if (!cookieValida(req.cookies.get(ASOC_COOKIE)?.value)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const f = form?.get("archivo");
  if (!(f instanceof File) || f.size === 0) return NextResponse.json({ error: "Adjunta un archivo." }, { status: 400 });
  if (f.size > MEDIA_MAX) return NextResponse.json({ error: `El archivo supera ${Math.round(MEDIA_MAX / 1024 / 1024)} MB.` }, { status: 400 });
  try {
    const url = await guardarMedia(Buffer.from(await f.arrayBuffer()), f.type);
    const tipo = /^video\//i.test(f.type) ? "video" : "imagen";
    return NextResponse.json({ ok: true, url, tipo });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "No se pudo subir el archivo." }, { status: 400 });
  }
}
