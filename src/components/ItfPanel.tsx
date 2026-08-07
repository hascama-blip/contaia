"use client";

// ITF (Impuesto a las Transacciones Financieras) — persona natural.
// A diferencia del reporte de rentas, el ITF SUNAT lo muestra EN PANTALLA (no lo
// envía por correo). Este apartado queda listo para conectar la extracción en
// pantalla más adelante.
export default function ItfPanel({ clienteId }: { clienteId: string }) {
  void clienteId;
  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">ITF — Impuesto a las Transacciones Financieras</h2>
        <span className="badge bg-slate-100 text-slate-500">Solo Usuario + Clave SOL</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        El reporte de ITF SUNAT lo genera <strong>en pantalla</strong> (no llega por correo). Este apartado quedará
        conectado a la extracción del ITF.
      </p>
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
        Extracción de ITF — próximamente.
      </div>
    </section>
  );
}
