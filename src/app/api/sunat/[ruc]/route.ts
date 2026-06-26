import { NextRequest, NextResponse } from "next/server";
import { consultarSunat, rucValido, debugDecolecta } from "@/lib/sunat";

export const runtime = "nodejs";

// Consulta SUNAT por RUC sin necesidad de un cliente existente.
// Se usa en el formulario de alta para autocompletar la razón social
// y demás datos a partir del RUC.
export async function GET(
  _req: NextRequest,
  { params }: { params: { ruc: string } }
) {
  const ruc = (params.ruc ?? "").trim();
  if (!rucValido(ruc)) {
    return NextResponse.json(
      { error: "El RUC debe tener 11 dígitos numéricos." },
      { status: 400 }
    );
  }
  // ?debug=1 → respuestas crudas de decolecta (para calibrar el mapeo).
  if (_req.nextUrl.searchParams.get("debug") === "1") {
    return NextResponse.json(await debugDecolecta(ruc));
  }
  try {
    const sunat = await consultarSunat(ruc);
    return NextResponse.json({ sunat });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Error consultando SUNAT" },
      { status: 502 }
    );
  }
}
