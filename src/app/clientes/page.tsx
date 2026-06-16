import Link from "next/link";
import { listClientes } from "@/lib/db";
import { CondicionBadge, EstadoBadge, RiesgoBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const clientes = await listClientes();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Clientes</h1>
        <Link href="/clientes/nuevo" className="btn-primary">
          + Nuevo cliente
        </Link>
      </div>

      {clientes.length === 0 ? (
        <div className="card grid place-items-center gap-2 p-12 text-center">
          <p className="text-slate-500">Aún no tienes clientes registrados.</p>
          <Link href="/clientes/nuevo" className="btn-primary mt-2">
            Crear el primero
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">RUC</th>
                <th className="px-4 py-3">Estado SUNAT</th>
                <th className="px-4 py-3">Condición</th>
                <th className="px-4 py-3">Diagnóstico</th>
                <th className="px-4 py-3">Docs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clientes.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/clientes/${c.id}`}
                      className="font-medium text-slate-800 hover:text-brand-600"
                    >
                      {c.razonSocial}
                    </Link>
                    {c.email && <p className="text-xs text-slate-400">{c.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.ruc}</td>
                  <td className="px-4 py-3">
                    {c.sunat ? <EstadoBadge estado={c.sunat.estado} /> : <Dash />}
                  </td>
                  <td className="px-4 py-3">
                    {c.sunat ? <CondicionBadge condicion={c.sunat.condicion} /> : <Dash />}
                  </td>
                  <td className="px-4 py-3">
                    {c.diagnostico ? (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700">
                          {c.diagnostico.score}
                        </span>
                        <RiesgoBadge nivel={c.diagnostico.nivelRiesgo} />
                      </div>
                    ) : (
                      <Dash />
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.documentos.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Dash() {
  return <span className="text-slate-300">—</span>;
}
