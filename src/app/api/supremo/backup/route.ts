import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";
import { crearBackupZip, leerStoreRaw, restaurarBackup } from "@/lib/backup";

export const runtime = "nodejs";
export const maxDuration = 120;

// GET            -> ZIP completo (store.json + uploads + snapshots diarios).
// GET ?solo=datos -> solo el store.json (rápido, la BD en sí).
// POST multipart { file, confirmar:"RESTAURAR" } -> restaura desde un backup
//   (store.json suelto o ZIP completo). Guarda copia del estado actual antes.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!esSupremo(user)) {
    return NextResponse.json({ error: "Solo el usuario supremo puede descargar el backup." }, { status: 403 });
  }
  const fecha = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

  if (new URL(req.url).searchParams.get("solo") === "datos") {
    const raw = await leerStoreRaw();
    return new NextResponse(raw, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="radar-datos-${fecha}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const zip = await crearBackupZip();
  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="radar-backup-${fecha}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!esSupremo(user)) {
    return NextResponse.json({ error: "Solo el usuario supremo puede restaurar un backup." }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const confirmar = String(form?.get("confirmar") ?? "");
  if (confirmar !== "RESTAURAR") {
    return NextResponse.json({ error: 'Confirmación requerida: escribe "RESTAURAR".' }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Adjunta el archivo de backup (.zip o .json)." }, { status: 400 });
  }
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const r = await restaurarBackup(buf, file.name);
    return NextResponse.json({
      ok: true,
      mensaje: `Restaurado: ${r.clientes} cliente(s), ${r.usuarios} usuario(s), ${r.archivosRestaurados} archivo(s). Se guardó una copia del estado anterior en backups/.`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}
