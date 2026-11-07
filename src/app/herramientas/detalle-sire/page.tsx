import Link from "next/link";
import { listClientes } from "@/lib/db";
import { studioId } from "@/lib/auth";
import { exigirModuloPagina } from "@/lib/acceso";
import DetalleSireTool from "@/components/DetalleSireTool";

export const dynamic = "force-dynamic";
export const metadata = { title: "Detalle SIRE — Radar Tributario" };

export default async function Page({ searchParams }: { searchParams: Promise<{ cliente?: string; tab?: string; periodo?: string }> }) {
  const sp = await searchParams;
  const user = await exigirModuloPagina("detalle-sire");
  const clientes = await listClientes(studioId(user));
  const min = clientes.map((c) => ({
    id: c.id,
    razonSocial: c.razonSocial,
    ruc: c.ruc,
    solUser: c.credSire?.solUser ?? "",
  }));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Detalle SIRE</h1>
        <p className="text-sm text-slate-500">
          Extrae el detalle de la propuesta SUNAT comprobante por comprobante, vía la API oficial.
          Elige el libro: <strong>Compras (RCE)</strong> o <strong>Ventas (RVIE)</strong> — cada uno se
          extrae por separado — y descárgalo en Excel.
        </p>
      </div>
      {/* Enlace directo (p. ej. desde la conciliación del Análisis RTP): empresa, libro y periodo ya elegidos. */}
      <DetalleSireTool
        clientes={min}
        inicialId={min.some((c) => c.id === sp.cliente) ? sp.cliente : undefined}
        inicialTab={sp.tab === "ventas" ? "ventas" : sp.tab === "compras" ? "compras" : undefined}
        inicialPeriodo={/^\d{6}$/.test(sp.periodo ?? "") ? sp.periodo : undefined}
      />
    </div>
  );
}
