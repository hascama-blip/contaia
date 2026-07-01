import { NextRequest, NextResponse } from "next/server";
import { requireUser, esAdmin, studioId } from "@/lib/auth";
import { createCliente, getClienteByRuc, setCredSire, duenoDeRuc, registrarRucGlobal } from "@/lib/db";
import { leerFilas } from "@/lib/xlsxIO";
import { logAccion } from "@/lib/auditoria";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILAS = 500; // tope por archivo (sin llamar a SUNAT por fila = rápido).

// Normaliza un encabezado: minúsculas, sin acentos ni separadores.
function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function buscarCol(headers: string[], ...claves: string[]): number {
  return headers.findIndex((h) => claves.some((k) => h.includes(k)));
}

// Carga masiva de clientes desde un Excel. Solo el admin del estudio.
// Columnas (en la 1ª fila, en cualquier orden): RUC (obligatorio), Razón social,
// Email, Teléfono, Usuario SOL, client_id, client_secret. La Clave SOL NO se carga.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!esAdmin(user)) {
    return NextResponse.json({ error: "Solo el administrador del estudio puede importar clientes." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Adjunta el archivo Excel (.xlsx)." }, { status: 400 });
  }

  let filas: unknown[][];
  try {
    filas = await leerFilas(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "No se pudo leer el Excel. ¿Es un .xlsx válido?" }, { status: 400 });
  }
  if (filas.length < 2) {
    return NextResponse.json({ error: "El Excel no tiene filas de datos (fila 1 = encabezados)." }, { status: 400 });
  }

  const headers = (filas[0] as unknown[]).map(norm);
  const iRuc = buscarCol(headers, "ruc");
  const iRazon = buscarCol(headers, "razonsocial", "razon", "empresa", "nombre");
  const iEmail = buscarCol(headers, "email", "correo");
  const iTel = buscarCol(headers, "telefono", "celular");
  const iUser = buscarCol(headers, "usuariosol", "usuario", "soluser", "usersol");
  const iCid = buscarCol(headers, "clientid", "idcliente");
  const iCsec = buscarCol(headers, "clientsecret", "secret");

  if (iRuc < 0) {
    return NextResponse.json({ error: "No se encontró la columna RUC en la primera fila." }, { status: 400 });
  }

  const cel = (row: unknown[], i: number) => (i >= 0 ? String(row[i] ?? "").trim() : "");
  const resultados: Array<{ fila: number; ruc: string; estado: "creado" | "duplicado" | "error"; razonSocial?: string; motivo?: string }> = [];
  let creados = 0;
  let procesadas = 0;

  for (let r = 1; r < filas.length; r++) {
    const row = filas[r] as unknown[];
    const ruc = cel(row, iRuc).replace(/\D/g, "");
    if (!ruc) continue; // fila vacía
    procesadas++;
    if (procesadas > MAX_FILAS) {
      resultados.push({ fila: r + 1, ruc, estado: "error", motivo: `Supera el tope de ${MAX_FILAS} por archivo. Divídelo.` });
      continue;
    }
    if (!/^\d{11}$/.test(ruc)) {
      resultados.push({ fila: r + 1, ruc, estado: "error", motivo: "RUC inválido (deben ser 11 dígitos)." });
      continue;
    }
    if (await getClienteByRuc(ruc, user.id)) {
      resultados.push({ fila: r + 1, ruc, estado: "duplicado", motivo: "Ya existe una empresa con ese RUC." });
      continue;
    }
    // Unicidad GLOBAL: si otro estudio ya tomó el RUC, no se agrega.
    const dueno = await duenoDeRuc(ruc);
    if (dueno && dueno.studioId !== studioId(user)) {
      resultados.push({ fila: r + 1, ruc, estado: "duplicado", motivo: "Ya registrada en la plataforma por otro usuario." });
      continue;
    }
    try {
      const razon = cel(row, iRazon) || `RUC ${ruc} (por verificar en SUNAT)`;
      const cliente = await createCliente({
        razonSocial: razon,
        ruc,
        email: cel(row, iEmail),
        telefono: cel(row, iTel),
        sunat: null,
        ownerId: user.id,
      });
      await registrarRucGlobal(ruc, studioId(user), cliente.id, user.nombre).catch(() => {});
      const solUser = cel(row, iUser);
      if (solUser) {
        await setCredSire(cliente.id, {
          solUser,
          clientId: cel(row, iCid),
          clientSecret: cel(row, iCsec),
          guardadoAt: new Date().toISOString(),
        });
      }
      creados++;
      resultados.push({ fila: r + 1, ruc, estado: "creado", razonSocial: razon });
    } catch (e) {
      resultados.push({ fila: r + 1, ruc, estado: "error", motivo: e instanceof Error ? e.message : "Error al crear." });
    }
  }

  if (creados > 0) {
    await logAccion({
      area: "Cliente",
      accion: "Importó empresas desde Excel (carga masiva)",
      detalle: `${creados} empresa(s) creada(s)`,
    });
  }

  return NextResponse.json({
    creados,
    duplicados: resultados.filter((x) => x.estado === "duplicado").length,
    errores: resultados.filter((x) => x.estado === "error").length,
    resultados,
  });
}
