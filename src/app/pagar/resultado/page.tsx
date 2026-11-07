import Link from "next/link";
import { requireUser } from "@/lib/auth";
import ResultadoPago from "@/components/ResultadoPago";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resultado del pago — Radar Tributario" };

// Retorno desde Mercado Pago (?pago=…&payment_id=…&status=…). El estado real se
// confirma en el servidor consultando a Mercado Pago, no con estos parámetros.
export default async function Page({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireUser();
  const pago = searchParams.pago ?? searchParams.external_reference ?? "";
  const paymentId = searchParams.payment_id ?? searchParams.collection_id ?? "";
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Link href="/planes" className="text-sm text-brand-600 hover:underline">← Planes</Link>
      <ResultadoPago pagoId={pago} paymentId={paymentId} />
    </div>
  );
}
