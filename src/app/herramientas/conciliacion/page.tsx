import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, esSupremo, modulosDelEstudio } from "@/lib/auth";
import ConciliacionPanel from "@/components/ConciliacionPanel";
import ComparativoIngresosPanel from "@/components/ComparativoIngresosPanel";
import OperacionesCajaPanel from "@/components/OperacionesCajaPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conciliación bancaria — Radar Tributario" };

export default async function Page() {
  const user = await requireUser();
  const mods = await modulosDelEstudio(user);
  if (!esSupremo(user) && !mods.has("conciliacion")) redirect("/");
  return (
    <div className="space-y-4">
      <div>
        <Link href="/" className="text-sm text-brand-600 hover:underline">← Menú</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Conciliación bancaria</h1>
        <p className="text-sm text-slate-500">
          Sube la <b>contabilidad</b> (Registro de Ventas), la <b>caja virtual</b> (los ZIP por sede, o el Excel de cobranzas) y los
          <b> bancos</b> (extractos en Excel, PDF o Word, una o varias cuentas). El sistema vincula cada comprobante con su cobro
          —por el <b>comprobante</b>— y cada cobro con su depósito o abono en el banco —por el <b>N° de operación</b>—, y te dice qué quedó
          <b> no conciliado</b>: comprobantes sin cobro, cobros sin depósito y abonos del banco sin cobro. Entrega el Excel con todo el detalle.
        </p>
      </div>
      <ConciliacionPanel />

      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">operaciones de la caja virtual (vouchers)</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <OperacionesCajaPanel />

      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">comparativo de ingresos (3 fuentes)</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <ComparativoIngresosPanel />
    </div>
  );
}
