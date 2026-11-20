import { consultarBuzon, descargarAdjuntoBuzon } from "./buzon";
import { descifrar } from "./cifrado";
import { enviarAlerta } from "./alertas";
import { elegirAvisosBuzon, textoAvisoBuzon } from "./avisosBuzon";
import { proximosVencimientos } from "./cronogramaSunat";
import { planEfectivo, diasParaVencerPlan } from "./auth";
import { planIncluye, PLAN_LABEL } from "./modulos";
import {
  listClientesVigilados, patchVigilancia, setVigilancia, getUserById, listAdmins, listClientes,
  alertaYaEnviada, marcarAlertaEnviada, getEstadoAlertas, setEstadoAlertas, mergeBuzon,
  getBuzonAdjunto, setBuzonAdjunto,
} from "./db";

// ============================================================
//  Tarea NOCTURNA de alertas
// ============================================================
//  1) Buzón: por cada empresa con vigilancia activa (Clave SOL cifrada, opt-in),
//     consulta el buzón y avisa de lo NUEVO al dueño del estudio (Telegram +
//     correo) en UN SOLO mensaje por empresa y noche: la notificación más
//     reciente (con su PDF) y, si llegaron más, la lista de las otras.
//     · Primera lectura tras activar: solo la ÚLTIMA notificación; las
//       anteriores quedan como vistas y no se envían (antes salían todas:
//       más de 300 mensajes en una noche).
//     · Lo que tenga más de MAX_DIAS_AVISO_BUZON días nunca se avisa.
//     Clave vencida (30 días) o rechazada 3 veces → se desactiva, se borra la
//     clave y se avisa.
//  2) Cronograma: SOLO las empresas marcadas en Alertas (`avisoVencimiento`) que
//     declaran en 3 días, 1 día u hoy (último dígito).
//  3) Plan: vence en 7, 3 o 1 día(s), o venció hoy.
//  Cada alerta se registra para no repetirse (clave única por día/evento).

const DIAS_AVISO_CRONO = [3, 1, 0];
const DIAS_AVISO_PLAN = [7, 3, 1, 0];

export interface ResumenNocturna {
  fecha: string;
  vigiladas: number;
  consultadas: number;
  mensajesNuevos: number;
  alertasBuzon: number;
  alertasCronograma: number;
  alertasPlan: number;
  desactivadas: number;
  errores: string[];
  duracionSeg: number;
}

const hoyLima = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Lima" }));
const fechaISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDia = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const fmtPeriodo = (p: string) => { const [y, m] = p.split("-"); return `${MESES[Number(m) - 1]} ${y}`; };

let corriendo = false;

/** Ejecuta la tarea. `forzar` ignora el "ya corrió hoy". */
export async function ejecutarNocturna(opts: { forzar?: boolean } = {}): Promise<ResumenNocturna | { omitida: string }> {
  const hoy = fechaISO(hoyLima());
  const estado = await getEstadoAlertas();
  if (!opts.forzar && estado.ultimaNocturna === hoy) return { omitida: `Ya se ejecutó hoy (${estado.ultimaNocturnaAt}).` };
  if (corriendo) return { omitida: "Ya hay una ejecución en curso." };
  corriendo = true;
  const t0 = Date.now();
  const r: ResumenNocturna = { fecha: hoy, vigiladas: 0, consultadas: 0, mensajesNuevos: 0, alertasBuzon: 0, alertasCronograma: 0, alertasPlan: 0, desactivadas: 0, errores: [], duracionSeg: 0 };
  try {
    await setEstadoAlertas({ ultimaNocturna: hoy, ultimaNocturnaAt: new Date().toISOString(), ultimaNocturnaResumen: "en curso…" });

    // ---------- 1) Buzón vigilado ----------
    const vigiladas = await listClientesVigilados();
    r.vigiladas = vigiladas.length;
    for (const c of vigiladas) {
      const v = c.vigilancia!;
      const dueno = c.ownerId ? await getUserById(c.ownerId) : null;
      if (!dueno) continue;
      // Plan: solo Premium/Equipo mantienen la vigilancia.
      if (!planIncluye(planEfectivo(dueno), "premium")) {
        await setVigilancia(c.id, null); r.desactivadas++;
        await enviarAlerta(dueno, { tipo: "sistema", titulo: `Vigilancia del buzón desactivada: ${c.razonSocial}`, texto: "Tu plan ya no incluye la vigilancia automática del buzón. La Clave SOL guardada fue borrada.", href: `/clientes/${c.id}` });
        continue;
      }
      // Clave vencida (30 días) → borrar y pedir que la vuelvan a escribir.
      if (v.venceAt && v.venceAt < new Date().toISOString()) {
        await setVigilancia(c.id, null); r.desactivadas++;
        await enviarAlerta(dueno, { tipo: "sistema", titulo: `Renueva la Clave SOL de ${c.razonSocial}`, texto: "Pasaron 30 días: por seguridad la clave guardada se borró y la vigilancia del buzón quedó pausada. Vuelve a activarla en la ficha de la empresa.", href: `/clientes/${c.id}` });
        continue;
      }
      let solPass = "";
      try { solPass = descifrar(v.claveEnc); } catch { r.errores.push(`${c.razonSocial}: no se pudo descifrar la clave`); continue; }
      try {
        const res = await consultarBuzon({ ruc: c.ruc, solUser: v.solUser, solPass, dias: 4 });
        r.consultadas++;
        if (res.loginError) {
          const n = (v.erroresSeguidos ?? 0) + 1;
          if (n >= 3) {
            await setVigilancia(c.id, null); r.desactivadas++;
            await enviarAlerta(dueno, { tipo: "sistema", titulo: `Clave SOL rechazada: ${c.razonSocial}`, texto: "SUNAT rechazó el acceso 3 noches seguidas. La clave guardada se borró y la vigilancia quedó pausada. Revisa tus accesos y vuelve a activarla.", href: `/clientes/${c.id}` });
          } else {
            await patchVigilancia(c.id, { erroresSeguidos: n, ultimoError: res.error ?? "Login rechazado", ultimoChequeo: new Date().toISOString() });
          }
          continue;
        }
        // El buzón es un historial: lo leído se AGREGA a lo guardado de la empresa.
        await mergeBuzon(c.id, res.mensajes).catch(() => null);
        const vistos = new Set(v.vistos ?? []);
        const sel = elegirAvisosBuzon(res.mensajes, v);
        const { nuevos, avisar } = sel;
        r.mensajesNuevos += nuevos.length;
        let avisado = false;
        if (avisar.length) {
          const m = avisar[0];
          // PDF adjunto de la más reciente: se descarga (y queda guardado) para
          // enviarlo junto con el aviso por Telegram y correo.
          let adjunto: { nombre: string; pdf: Buffer } | null = await getBuzonAdjunto(c.id, m.id).catch(() => null);
          if (!adjunto && m.adjuntos !== 0) {
            try {
              const d = await descargarAdjuntoBuzon({ ruc: c.ruc, solUser: v.solUser, solPass, codMensaje: m.id, asunto: m.asunto, fecha: m.fecha, origen: m.origen, adjuntos: m.adjuntos });
              if (d.ok && d.pdfBase64) {
                const pdf = Buffer.from(d.pdfBase64, "base64");
                const nombre = d.filename ?? `mensaje-${m.id}.pdf`;
                await setBuzonAdjunto(c.id, m.id, pdf, nombre).catch(() => {});
                adjunto = { nombre, pdf };
              }
            } catch (e) { r.errores.push(`${c.razonSocial} · PDF ${m.id}: ${e instanceof Error ? e.message : "error"}`); }
          }
          const { titulo, texto } = textoAvisoBuzon(c, sel, Boolean(adjunto));
          const env = await enviarAlerta(dueno, { tipo: "buzon", titulo, texto, href: `/clientes/${c.id}` }, adjunto);
          if (env.telegram || env.email) { r.alertasBuzon++; avisado = true; }
          if (env.errores.length) r.errores.push(`${c.razonSocial}: ${env.errores.join(" · ")}`);
        }
        // Todo lo leído queda como visto (también lo pasado que no se envió).
        for (const m of nuevos) vistos.add(m.id);
        await patchVigilancia(c.id, {
          vistos: Array.from(vistos).slice(-500), erroresSeguidos: 0, ultimoError: undefined,
          base: true, ultimoChequeo: new Date().toISOString(), ...(avisado ? { ultimaAlerta: new Date().toISOString() } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "error";
        r.errores.push(`${c.razonSocial}: ${msg}`);
        await patchVigilancia(c.id, { ultimoError: msg, ultimoChequeo: new Date().toISOString() });
      }
    }

    // ---------- 2) Cronograma DDJJ + 3) Plan, por estudio ----------
    for (const admin of await listAdmins()) {
      if (admin.estado && admin.estado !== "aprobado") continue;
      const tieneCanal = Boolean(admin.alertas?.telegramChatId) || admin.alertas?.email !== false;
      if (!tieneCanal) continue;

      if (admin.alertas?.cronograma !== false) {
        // Las empresas de simulación (demos) no generan alertas reales.
        // Solo las empresas que el estudio marcó en Alertas (por defecto, ninguna).
        const clientes = (await listClientes(admin.id, { todos: true })).filter((c) => !c.demo && c.avisoVencimiento === true);
        const prox = proximosVencimientos(clientes.map((c) => ({ id: c.id, ruc: c.ruc, razonSocial: c.razonSocial })), 3, hoyLima());
        for (const p of prox) {
          if (!DIAS_AVISO_CRONO.includes(p.dias)) continue;
          const clave = `crono|${p.clienteId}|${p.periodo}|${p.dias}`;
          if (await alertaYaEnviada(clave)) continue;
          const cuando = p.dias === 0 ? "HOY" : p.dias === 1 ? "MAÑANA" : `en ${p.dias} días`;
          const env = await enviarAlerta(admin, {
            tipo: "cronograma",
            titulo: `${p.razonSocial} declara ${cuando} (${fmtDia(p.fecha)})`,
            texto: `Periodo ${fmtPeriodo(p.periodo)} · RUC termina en ${p.ruc.slice(-1)} (grupo ${p.grupo})${p.oficial ? "" : " · fecha referencial"}. Presenta la declaración mensual antes del vencimiento.`,
            href: `/clientes/${p.clienteId}`,
          });
          if (env.telegram || env.email) { r.alertasCronograma++; await marcarAlertaEnviada(clave); }
          if (env.errores.length) r.errores.push(`${p.razonSocial}: ${env.errores.join(" · ")}`);
        }
      }

      const dias = diasParaVencerPlan(admin);
      if (dias != null && DIAS_AVISO_PLAN.includes(dias)) {
        const clave = `plan|${admin.id}|${admin.planVence}|${dias}`;
        if (!(await alertaYaEnviada(clave))) {
          const nombre = PLAN_LABEL[(admin.plan ?? "basico") as keyof typeof PLAN_LABEL];
          const env = await enviarAlerta(admin, {
            tipo: "plan",
            titulo: dias === 0 ? `Tu ${nombre} vence hoy` : `Tu ${nombre} vence en ${dias} día${dias === 1 ? "" : "s"}`,
            texto: dias === 0
              ? "A partir de mañana la cuenta pasa al plan Básico y se pausan los módulos de paga. Renueva para no perder el acceso."
              : `Vence el ${fmtDia(admin.planVence!)}. Renueva a tiempo para mantener tus módulos y la vigilancia del buzón.`,
            href: admin.plan === "regular" || admin.plan === "premium" ? `/pagar?plan=${admin.plan}` : "/planes",
          });
          if (env.telegram || env.email) { r.alertasPlan++; await marcarAlertaEnviada(clave); }
        }
      }
    }
  } finally {
    corriendo = false;
    r.duracionSeg = Math.round((Date.now() - t0) / 1000);
    await setEstadoAlertas({
      ultimaNocturnaResumen: `${r.consultadas}/${r.vigiladas} buzones · ${r.mensajesNuevos} mensajes nuevos · ${r.alertasBuzon + r.alertasCronograma + r.alertasPlan} alertas · ${r.errores.length} errores · ${r.duracionSeg}s`,
    }).catch(() => {});
  }
  return r;
}

// El planificador vive en src/instrumentation.ts: cada 20 minutos, a partir de
// NOCTURNA_HORA (Lima), llama a POST /api/tareas/nocturna; aquí se decide si ya
// corrió hoy. Un cron externo puede hacer lo mismo con ?token=CRON_SECRET.
