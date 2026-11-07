import { limitar, ipDe, MIN, HORA } from "@/lib/limite";
import { NextRequest, NextResponse } from "next/server";
import { getRatings, addRating } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → todas las valoraciones (público): { [cursoId]: {sum, count} }.
export async function GET() {
  return NextResponse.json({ ratings: await getRatings() });
}

// POST → valorar un curso (1..5). Público. Devuelve el agregado del curso.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cursoId = String(body?.cursoId ?? "").trim();
  const valor = Number(body?.valor);
  if (!/^[a-f0-9]{4,}$/i.test(cursoId)) return NextResponse.json({ error: "Curso inválido." }, { status: 400 });
  if (!(valor >= 1 && valor <= 5)) return NextResponse.json({ error: "Calificación inválida (1 a 5)." }, { status: 400 });
  const _lim = limitar([
    { clave: `asoc-rate:${ipDe(req)}`, max: 30, ventanaMs: HORA },
    { clave: `asoc-rate:${ipDe(req)}:${cursoId}`, max: 1, ventanaMs: 24 * HORA },
  ], "Ya calificaste este curso.");
  if (_lim) return _lim;
  const agg = await addRating(cursoId, valor);
  return NextResponse.json({ ok: true, cursoId, agg });
}
