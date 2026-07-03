"use client";

import { useState } from "react";

export function PrintButton() {
  return (
    <button className="btn-ghost no-print" onClick={() => window.print()}>
      🖨 Imprimir
    </button>
  );
}

// Descarga el informe en PDF generado en el servidor (sin encabezado/pie del
// navegador: sin fecha, hora, URL ni número de página).
export function DescargarPdfBtn({ clienteId }: { clienteId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/informe/pdf`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "No se pudo generar el PDF.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Error de red al generar el PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="no-print inline-flex flex-col items-end gap-1">
      <button className="btn-primary" onClick={descargar} disabled={busy}>
        {busy ? "Generando PDF…" : "⬇ Descargar PDF"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
