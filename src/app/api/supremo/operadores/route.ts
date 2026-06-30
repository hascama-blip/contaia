import { NextRequest, NextResponse } from "next/server";
import { esSupremo, getCurrentUser, publicUser } from "@/lib/auth";
import { listSubUsuarios } from "@/lib/db";

export const runtime = "nodejs";

// Operadores (trabajadores) de una cuenta/estudio. Solo el supremo.
export async function GET(req: NextRequest) {
  if (!esSupremo(await getCurrentUser())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const adminId = req.nextUrl.searchParams.get("adminId") ?? "";
  if (!adminId) return NextResponse.json({ operadores: [] });
  const operadores = (await listSubUsuarios(adminId)).map(publicUser);
  return NextResponse.json({ operadores });
}
