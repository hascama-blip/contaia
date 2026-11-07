import Link from "next/link";
import { documentosLegales, TERMINOS_VERSION } from "@/lib/legal";

export const metadata = { title: "Políticas · Radar Tributar IA" };

// Página PÚBLICA con la Política de seguridad y la Declaración de
// responsabilidad (se enlaza desde el registro y la pantalla de aceptación).
export default function LegalPage() {
  const docs = documentosLegales();
  const fecha = new Date(`${TERMINOS_VERSION}T12:00:00Z`).toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Volver</Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-800">Políticas de la plataforma</h1>
        <p className="mt-1 text-sm text-slate-500">Versión vigente desde el {fecha}.</p>
        <nav className="mt-4 flex flex-wrap gap-2 text-sm">
          {docs.map((d) => (
            <a key={d.id} href={`#${d.id}`} className="rounded-full border border-slate-300 px-3 py-1 text-slate-600 hover:border-brand-500 hover:text-brand-700">{d.titulo}</a>
          ))}
        </nav>
      </div>
      {docs.map((d) => (
        <section key={d.id} id={d.id} className="card mb-6 scroll-mt-6 p-6">
          <h2 className="text-lg font-bold text-slate-800">{d.titulo}</h2>
          <p className="mt-1 text-sm text-slate-500">{d.resumen}</p>
          <div className="mt-5 space-y-5">
            {d.secciones.map((s) => (
              <div key={s.titulo}>
                <h3 className="text-sm font-semibold text-slate-700">{s.titulo}</h3>
                {s.parrafos.map((p, i) => (
                  <p key={i} className="mt-2 text-sm leading-relaxed text-slate-600">{p}</p>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
