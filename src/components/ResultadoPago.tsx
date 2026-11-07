"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const NOMBRE: Record<string, string> = { regular: "Plan Regular", premium: "Plan Premium" };

// Consulta el estado del pago (el servidor lo verifica con la pasarela) y
// reintenta unos segundos mientras la pasarela termina de confirmarlo.
export default function ResultadoPago({ pagoId, paymentId }: { pagoId: string; paymentId: string }) {
  const [estado, setEstado] = useState<{ estado: string; plan?: string; vigenteHasta?: string | null; detalle?: string } | null>(null);

  useEffect(() => {
    if (!pagoId) { setEstado({ estado: "desconocido" }); return; }
    let vivo = true, intentos = 0;
    const consultar = async () => {
      const q = paymentId ? `?payment_id=${encodeURIComponent(paymentId)}` : "";
      const d = await fetch(`/api/pagos/${encodeURIComponent(pagoId)}${q}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (!vivo) return;
      if (d) setEstado(d);
      intentos++;
      if ((!d || d.estado === "pendiente") && intentos < 12) setTimeout(consultar, 5000);
    };
    consultar();
    return () => { vivo = false; };
  }, [pagoId, paymentId]);

  if (!estado) return <div className="card p-6 text-sm text-slate-500">Confirmando tu pago…</div>;
  if (estado.estado === "pagado") {
    const vence = estado.vigenteHasta ? new Date(`${estado.vigenteHasta}T12:00:00Z`).toLocaleDateString("es-PE", { timeZone: "UTC" }) : "";
    return (
      <div className="card p-6 text-center">
        <p className="text-3xl">✅</p>
        <h1 className="mt-2 text-xl font-bold text-slate-800">¡{NOMBRE[estado.plan ?? ""] ?? "Plan"} activado!</h1>
        <p className="mt-1 text-sm text-slate-500">Tus módulos ya están desbloqueados{vence ? ` hasta el ${vence}` : ""}.</p>
        <a href="/" className="btn-primary mt-4 inline-flex">Ir al inicio</a>
      </div>
    );
  }
  if (estado.estado === "pendiente") {
    return (
      <div className="card p-6 text-center">
        <p className="text-3xl">⏳</p>
        <h1 className="mt-2 text-lg font-bold text-slate-800">Tu pago está en proceso</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cuando la pasarela lo confirme, tu plan se activa solo y te llega un aviso. Puedes cerrar esta página.
        </p>
      </div>
    );
  }
  return (
    <div className="card p-6 text-center">
      <p className="text-3xl">⚠️</p>
      <h1 className="mt-2 text-lg font-bold text-slate-800">El pago no se completó</h1>
      <p className="mt-1 text-sm text-slate-500">{estado.detalle ?? "No se realizó ningún cobro."}</p>
      <Link href="/planes" className="btn-primary mt-4 inline-flex">Intentar de nuevo</Link>
    </div>
  );
}
