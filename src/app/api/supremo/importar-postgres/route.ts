import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, esSupremo } from "@/lib/auth";
import { inspeccionarPostgres, leerStoreDesdePostgres, aplicarImport } from "@/lib/importarPostgres";

export const runtime = "nodejs";
export const maxDuration = 300;

// SOLO SUPREMO. Migra los datos de la web vieja (Postgres en AWS/RDS):
//  POST { url, accion:"probar" }                         → tablas, filas y columnas.
//  POST { url, accion:"previsualizar" }                  → cuenta lo que se importaría.
//  POST { url, accion:"importar", modo, confirmar:"IMPORTAR" } → escribe el store.
export async function POST(req: NextRequest) {
  if (!esSupremo(await getCurrentUser())) return NextResponse.json({ error: "Solo el supremo." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const url = String(body?.url ?? "").trim();
  if (!/^postgres(ql)?:\/\//i.test(url)) return NextResponse.json({ error: "Pega la URL de conexión (postgresql://usuario:clave@host:5432/base)." }, { status: 400 });
  const accion = String(body?.accion ?? "probar");
  try {
    if (accion === "probar") return NextResponse.json(await inspeccionarPostgres(url));
    const { store, resumen } = await leerStoreDesdePostgres(url);
    if (accion === "previsualizar") return NextResponse.json({ resumen });
    if (accion === "importar") {
      if (body?.confirmar !== "IMPORTAR") return NextResponse.json({ error: 'Confirmación requerida: escribe "IMPORTAR".' }, { status: 400 });
      const modo = body?.modo === "reemplazar" ? "reemplazar" : "fusionar";
      const r = await aplicarImport(store, modo);
      return NextResponse.json({ ok: true, resumen, ...r, modo });
    }
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo conectar a la base." }, { status: 400 });
  }
}
