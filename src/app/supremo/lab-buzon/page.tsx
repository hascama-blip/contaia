import Link from "next/link";
import { requireSupremo } from "@/lib/auth";
import LabBuzonApi from "@/components/LabBuzonApi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lab · Buzón por API — Radar Tributario" };

// Prueba AISLADA (solo supremo): investigar si el buzón se puede leer por API
// oficial (HTTP, sin navegador). No toca el buzón/SIRE de producción.
export default async function Page() {
  await requireSupremo();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/supremo" className="text-sm text-brand-600 hover:underline">← Volver a Supremo</Link>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">Lab · Buzón por API (sin navegador)</h1>
        <p className="text-sm text-slate-500">
          Prueba aislada para ver si el buzón se puede leer por API oficial (HTTP, sin scraping).
          <b> No afecta nada de producción</b> — el buzón actual sigue igual. Saca el token OAuth
          (como el SIRE) y prueba un endpoint con ese token.
        </p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <b>Cómo usarlo:</b> pon las credenciales de una empresa (con SIRE/Control de mensajes habilitado).
        Primero con el scope del SIRE confirma que el token sale ✅. Luego prueba el endpoint del buzón:
        si devuelve <b>HTTP 200 con JSON de mensajes</b>, el buzón por API es viable y migramos. Si da
        401/403, ese endpoint necesita otra autenticación y seguimos como estamos.
      </div>
      <LabBuzonApi />
    </div>
  );
}
