import { NextRequest, NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { bloqueoModulo } from "@/lib/acceso";
import { requireUser, esSupremo } from "@/lib/auth";
import { limitar, HORA } from "@/lib/limite";
import { logAccion } from "@/lib/auditoria";
import { conectarCaja, listarCaja, archivosDelDia, cerrarSesionCaja, type DiaCaja } from "@/lib/cajaVirtual";

export const runtime = "nodejs";
export const maxDuration = 180;

// Utilitario "Caja virtual": reportes diarios por sede (PDF, Excel y carpeta de Drive).
// POST JSON { accion }:
//   conectar { usuario, clave }                      → { sid, empresas }  (la clave NO se guarda)
//   listar   { sid, empresa, rubro, desde, hasta }    → { sedes: [{ sede, …, dias: [...] }] }
//   dia      { sid, empresa, rubro, dia, pdf, excel, drive } → ZIP con los archivos de ese día
//   cerrar   { sid }
// La traza (diag) solo vuelve al supremo.
export async function POST(req: NextRequest) {
  const _b = await bloqueoModulo("caja-virtual"); if (_b) return _b;
  const user = await requireUser();
  const body = await req.json().catch(() => ({}));
  const accion = String(body?.accion ?? "");
  const sid = String(body?.sid ?? "");
  const supremo = esSupremo(user);
  const txt = (v: unknown, max = 120) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

  try {
    if (accion === "conectar") {
      // Pocas conexiones por hora: es el ingreso a un sistema externo (evita probar claves).
      const lim = limitar([{ clave: `caja-virtual:${user.id}`, max: 12, ventanaMs: HORA }], "Demasiados intentos de conexión a la caja virtual.");
      if (lim) return lim;
      const r = await conectarCaja(txt(body?.usuario, 80), String(body?.clave ?? "").slice(0, 120), user.id);
      await logAccion({ area: "Caja virtual", accion: "Conectó a la caja virtual", detalle: `Usuario ${txt(body?.usuario, 80)} · ${r.empresas.length} empresa(s)` }).catch(() => {});
      return NextResponse.json({ sid: r.sid, empresas: r.empresas, ...(supremo ? { diag: r.diag } : {}) });
    }
    if (accion === "listar") {
      const r = await listarCaja(sid, user.id, { empresa: txt(body?.empresa, 40), rubro: txt(body?.rubro, 40), desde: txt(body?.desde, 10), hasta: txt(body?.hasta, 10) });
      await logAccion({ area: "Caja virtual", accion: "Consultó ingresos por sede", detalle: `${txt(body?.desde, 10)} al ${txt(body?.hasta, 10)} · ${r.sedes.length} sede(s) · ${r.sedes.reduce((a, s) => a + s.dias.length, 0)} día(s)` }).catch(() => {});
      return NextResponse.json({ sedes: r.sedes, ...(supremo ? { diag: r.diag } : {}) });
    }
    if (accion === "dia") {
      const d = body?.dia ?? {};
      const dia: DiaCaja = {
        idingreso: txt(d.idingreso, 20).replace(/\D/g, ""), sede: txt(d.sede), dia: txt(d.dia, 20), fecha: txt(d.fecha, 10), estado: txt(d.estado, 40),
        responsable: txt(d.responsable), codempresa: txt(d.codempresa, 20), drive: txt(d.drive, 80),
        totalCurso: 0, totalDeuda: 0, totalPromotor: 0, totalDetraccion: 0, totalPago: 0, deudaActual: 0,
      };
      if (!dia.idingreso) return NextResponse.json({ error: "Falta el día." }, { status: 400 });
      const r = await archivosDelDia(sid, user.id, { empresa: txt(body?.empresa, 40), rubro: txt(body?.rubro, 40), dia, pdf: body?.pdf !== false, excel: body?.excel !== false, drive: body?.drive !== false });
      const zip: Record<string, Uint8Array> = {};
      for (const a of r.archivos) zip[a.nombre] = new Uint8Array(a.data);
      if (r.notas.length) zip["_notas.txt"] = strToU8(r.notas.join("\n"));
      // Sin compresión: son PDF/Office (ya comprimidos) y el navegador los vuelve a empaquetar por sede.
      return new NextResponse(Buffer.from(zipSync(zip, { level: 0 })) as unknown as BodyInit, {
        headers: { "Content-Type": "application/zip", "Cache-Control": "no-store", "X-Caja-Archivos": String(r.archivos.length), "X-Caja-Notas": String(r.notas.length) },
      });
    }
    if (accion === "cerrar") { cerrarSesionCaja(sid, user.id); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo completar.";
    const vencida = /venció/.test(msg);
    if (!vencida) console.error("[caja-virtual]", accion, msg);
    return NextResponse.json({ error: msg, ...(vencida ? { vencida: true } : {}) }, { status: vencida ? 401 : 502 });
  }
}
