import Link from "next/link";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { PLANES, CONTACTO, waPlan } from "@/lib/planes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Adquirir módulos — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();

  // Link de "perfil" del solicitante (para que el supremo lo identifique y le dé el acceso).
  const h = headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "radartributaria.com"}`;
  const perfil = `${origin}/supremo?u=${user.id}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Adquirir todos los módulos</h1>
        <p className="text-sm text-slate-500">
          Elige el plan que necesitas. Puedes empezar gratis y ampliar cuando quieras.
        </p>
      </div>

      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANES.map((p) => (
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

            <h2 className="text-lg font-bold text-slate-800">{p.nombre}</h2>

            {/* Precio */}
            <div className="mt-1 flex items-end gap-2">
              <span className="text-2xl font-extrabold text-slate-900">{p.precio}</span>
              {p.periodo && <span className="pb-1 text-xs text-slate-400">{p.periodo}</span>}
              {p.precioAntes && <span className="pb-1 text-sm text-slate-400 line-through">{p.precioAntes}</span>}
            </div>
            {p.etiqueta && (
              <span className="mt-1 inline-flex w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                {p.etiqueta}
              </span>
            )}

            <p className="mt-2 text-sm text-slate-500">{p.resumen}</p>

            <div className="mt-4 flex-1 space-y-4">
              {p.incluidos.map((grupo, gi) => (
                <div key={gi}>
                  <p className="mb-1 text-sm font-semibold text-slate-800">{grupo.titulo}</p>
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

              {p.proximamente && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">🔜 {p.proximamente.titulo}</p>
                  <ul className="space-y-1">
                    {p.proximamente.puntos.map((pt, pi) => (
                      <li key={pi} className="flex gap-2 text-xs text-slate-500">
                        <span className="mt-0.5">•</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {p.gratis ? (
              <Link
                href={p.ctaHref || "/"}
                className={`mt-5 w-full text-center ${p.ctaEstilo === "ghost" ? "btn-ghost" : "btn-primary"}`}
              >
                {p.cta}
              </Link>
            ) : (
              <a
                href={waPlan(user.nombre, p.nombre, perfil)}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-5 w-full text-center ${p.ctaEstilo === "accent" ? "btn-accent" : "btn-primary"}`}
              >
                {p.cta}
              </a>
            )}
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-slate-400">
        ¿Dudas sobre qué plan te conviene? Escríbenos a{" "}
        <a href={`mailto:${CONTACTO}`} className="text-brand-600 hover:underline">{CONTACTO}</a>.
      </p>
    </div>
  );
}
