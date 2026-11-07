import Link from "next/link";
import { headers } from "next/headers";
import { requireUser, bloquearSiSoloRtp, planDelEstudio, esSupremo } from "@/lib/auth";
import { getUserById } from "@/lib/db";
import { PLANES, CONTACTO, waPlan } from "@/lib/planes";
import { estadoLanzamiento, pasarelaActiva } from "@/lib/pagos";
import BotonPagar from "@/components/BotonPagar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Adquirir módulos — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  bloquearSiSoloRtp(user);

  // Link de "perfil" del solicitante (para que el supremo lo identifique y le dé el acceso).
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "radartributaria.com"}`;
  const perfil = `${origin}/supremo?u=${user.id}`;

  const lanz = await estadoLanzamiento();
  const pagoEnLinea = !!pasarelaActiva().pasarela;
  const planActual = await planDelEstudio(user);
  const admin = user.parentId ? await getUserById(user.parentId) : user;
  const conLanzamiento = admin?.precioLanzamiento === true || lanz.restantes > 0;
  const vence = !esSupremo(user) && planActual !== "basico" && admin?.planVence
    ? new Date(`${admin.planVence}T12:00:00Z`).toLocaleDateString("es-PE", { timeZone: "UTC" })
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Adquirir todos los módulos</h1>
        <p className="text-sm text-slate-500">
          Elige el plan que necesitas. Paga en línea y tus módulos se desbloquean al instante, por 30 días.
          {vence && <> Tu plan actual vence el <b>{vence}</b>.</>}
        </p>
      </div>

      {conLanzamiento && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          🎉 <b>Precio de lanzamiento −50 %</b> para las primeras {lanz.cupos} personas.
          {admin?.precioLanzamiento ? " Ya lo tienes asegurado: lo conservas al renovar." : ` Quedan ${lanz.restantes} cupos.`}
        </div>
      )}

      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANES.map((p) => {
          const esActual = planActual === p.planId && !esSupremo(user);
          const precio = conLanzamiento || !p.precioAntes ? p.precio : p.precioAntes;
          return (
            <div
              key={p.nombre}
              className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${
                p.destacado ? "border-accent-300 ring-2 ring-accent-200" : "border-slate-200"
              }`}
            >
              {p.destacado && (
                <span className="absolute -top-3 left-5 rounded-full bg-accent-400 px-3 py-0.5 text-xs font-bold text-brand-900 shadow">
                  Más popular
                </span>
              )}

              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-800">{p.nombre}</h2>
                {esActual && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700">Tu plan</span>}
              </div>

              {/* Precio */}
              <div className="mt-1 flex items-end gap-2">
                <span className="text-2xl font-extrabold text-slate-900">{precio}</span>
                {p.periodo && <span className="pb-1 text-xs text-slate-400">{p.periodo}</span>}
                {conLanzamiento && p.precioAntes && <span className="pb-1 text-sm text-slate-400 line-through">{p.precioAntes}</span>}
              </div>
              {conLanzamiento && p.etiqueta && (
                <span className="mt-1 inline-flex w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                  {p.etiqueta}
                </span>
              )}

              <p className="mt-2 text-sm text-slate-500">{p.resumen}</p>

              <div className="mt-4 flex-1 space-y-4">
                {p.incluidos.map((grupo, gi) => (
                  <div key={gi} className={grupo.nuevo ? "sheen rounded-xl border border-accent-300 bg-accent-50 p-3" : ""}>
                    <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                      {grupo.nuevo && <span className="rounded-full bg-accent-400 px-2 py-0.5 text-[10px] font-bold text-brand-900">NUEVO</span>}
                      {grupo.titulo}
                    </p>
                    <ul className="space-y-1">
                      {grupo.puntos.map((pt, pi) => (
                        <li key={pi} className="flex gap-2 text-xs text-slate-600">
                          <span className="mt-0.5 text-emerald-500">✓</span>
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {p.gratis ? (
                <Link href={p.ctaHref || "/"} className="btn-ghost mt-5 w-full text-center">
                  {esActual ? "Seguir con el plan gratis" : p.cta}
                </Link>
              ) : p.ctaHref && pagoEnLinea && (p.planId === "regular" || p.planId === "premium") ? (
                <BotonPagar
                  plan={p.planId}
                  texto={esActual ? `Renovar ${p.nombre}` : p.cta}
                  className={`mt-5 w-full text-center ${p.ctaEstilo === "accent" ? "btn-accent" : "btn-primary"}`}
                  whatsapp={waPlan(user.nombre, p.nombre, perfil)}
                />
              ) : (
                <a
                  href={waPlan(user.nombre, p.nombre, perfil)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`mt-5 w-full text-center ${p.ctaEstilo === "accent" ? "btn-accent" : "btn-primary"}`}
                >
                  {p.ctaHref ? `Solicitar ${p.nombre}` : p.cta}
                </a>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-400">
        Los planes de pago duran 30 días y no se renuevan solos: te avisamos antes de que venzan. ¿Dudas? Escríbenos a{" "}
        <a href={`mailto:${CONTACTO}`} className="text-brand-600 hover:underline">{CONTACTO}</a>.
      </p>
    </div>
  );
}
