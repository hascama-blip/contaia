import { NextRequest, NextResponse } from "next/server";
import { ASOC_COOKIE, cookieValida, edicionHabilitada } from "@/lib/asociacion";

export const runtime = "nodejs";

// GET → ¿la edición está habilitada en el server y estoy editando?
export async function GET(req: NextRequest) {
  return NextResponse.json({
    habilitada: edicionHabilitada(),
    editando: cookieValida(req.cookies.get(ASOC_COOKIE)?.value),
  });
}
