import Link from "next/link";
import CruceSirePanel from "@/components/CruceSirePanel";
import FacturasXmlPanel from "@/components/FacturasXmlPanel";

export const metadata = { title: "Cruce + Glosa + Cuenta → Contasis — Radar Tributario" };

function Paso({ n, titulo, detalle }: { n: string; titulo: string; detalle: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="step-num shrink-0">{n}</span>
      <div>
        <h2 className="font-bold text-slate-800">{titulo}</h2>
        <p className="text-sm text-slate-500">{detalle}</p>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">
          Cruce SIRE + Glosa + Cuenta → Contasis
        </h1>
        <p className="text-sm text-slate-500">
          Sigue los pasos en orden: del cruce al masivo listo para importar.
        </p>
      </div>

      {/* Paso 1 */}
      <section className="space-y-3">
        <Paso
          n="1"
          titulo="Cruce SIRE vs Contabilidad"
          detalle="Sube el SIRE y los libros de Contasis y saca el reporte de diferencias (comprobante por comprobante)."
        />
        <CruceSirePanel />
      </section>

      <div className="h-px bg-slate-200" />

      {/* Paso 2 */}
      <section className="space-y-3">
        <Paso
          n="2"
          titulo="Glosa (XML) + Cuenta → masivo Contasis"
          detalle="Sube los XML de las facturas: a cada una se le asigna su glosa (descripción) y su cuenta por rubro. Confirma los proveedores nuevos y descarga el masivo para Contasis."
        />
        <FacturasXmlPanel />
      </section>
    </div>
  );
}
