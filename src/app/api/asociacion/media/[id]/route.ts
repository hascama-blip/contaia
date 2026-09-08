import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { MEDIA_DIR, contentTypeDe, idMediaValido, ASOC_COOKIE, cookieValida } from "@/lib/asociacion";

export const runtime = "nodejs";

// GET → sirve el medio (público). Soporta Range para video.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  if (!idMediaValido(id)) return new NextResponse("No encontrado", { status: 404 });
  const file = path.join(MEDIA_DIR, id);
  try {
    const data = await fs.readFile(file);
    const ct = contentTypeDe(id);
    const rango = req.headers.get("range");
    // Range para reproducir video (seek).
    if (rango && /^video\//.test(ct)) {
      const m = /bytes=(\d*)-(\d*)/.exec(rango);
      const total = data.length;
      let ini = m && m[1] ? parseInt(m[1], 10) : 0;
      let fin = m && m[2] ? parseInt(m[2], 10) : total - 1;
      if (isNaN(ini) || ini < 0) ini = 0;
      if (isNaN(fin) || fin >= total) fin = total - 1;
      const chunk = data.subarray(ini, fin + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          "Content-Type": ct,
          "Content-Range": `bytes ${ini}-${fin}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunk.length),
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
    return new NextResponse(data, {
      headers: { "Content-Type": ct, "Cache-Control": "public, max-age=31536000, immutable", "Accept-Ranges": "bytes" },
    });
  } catch {
    return new NextResponse("No encontrado", { status: 404 });
  }
}

// DELETE → borra un medio (requiere cookie de edición).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!cookieValida(req.cookies.get(ASOC_COOKIE)?.value)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const id = params.id;
  if (!idMediaValido(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  await fs.unlink(path.join(MEDIA_DIR, id)).catch(() => {});
  return NextResponse.json({ ok: true });
}
