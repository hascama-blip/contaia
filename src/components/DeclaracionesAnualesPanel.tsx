"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeclaracionAnual } from "@/lib/types";
import { compararAnual } from "@/lib/declaracionAnual";
import { fmtSoles } from "./ui";

export default function DeclaracionesAnualesPanel({
  clienteId,
  clienteRuc,
  inicial,
}: {
  clienteId: string;
  clienteRuc: string;
  inicial: DeclaracionAnual[];
}) {
  const router = useRouter();
  const [decls, setDecls] = useState<DeclaracionAnual[]>(inicial ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function merge(prev: DeclaracionAnual[], d: DeclaracionAnual) {
    return [...prev.filter((x) => x.ejercicio !== d.ejercicio), d].sort((a, b) =>
      a.ejercicio.localeCompare(b.ejercicio)
    );
  }

  async function subir(lista: FileList) {
    setBusy("upload");
    setError(null);
    setResumen(null);
    setDiag(null);
    try {
      const fd = new FormData();
      Array.from(lista).forEach((f) => fd.append("file", f));
      if (diagModo) fd.append("diagnostico", "true");
      const res = await fetch(`/api/clientes/${clienteId}/declaraciones-anuales`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudieron leer los PDF.");
        return;
      }
      if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
      const resultados: any[] = data.resultados ?? [];
      let guardadas = 0;
      const errores: string[] = [];
      const cruces: string[] = [];
      setDecls((prev) => {
        let acc = prev;
        for (const r of resultados) {
          if (r.ok && r.declaracion) {
            acc = merge(acc, r.declaracion);
            guardadas++;
            if (r.cruce) cruces.push(`${r.archivo} (RUC ${r.declaracion.ruc})`);
          } else {
            errores.push(`${r.archivo}: ${r.motivo ?? "error"}`);
          }
        }
        return acc;
      });
      const partes = [`✅ ${guardadas} año(s) cargado(s)`];
      if (errores.length) partes.push(`⛔ ${errores.length} con error`);
      setResumen(partes.join(" · "));
      const msgs: string[] = [];
      if (errores.length) msgs.push(errores.join(" | "));
      if (cruces.length)
        msgs.push(
          `⚠ POSIBLE CRUCE: el RUC del PDF no coincide con el del cliente (${clienteRuc}): ${cruces.join(", ")}`
        );
      setError(msgs.join("  ·  ") || null);
      router.refresh();
    } catch {
      setError("Error de red al subir los PDF.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function eliminar(id: string) {
    setBusy("del");
    try {
      const res = await fetch(
        `/api/clientes/${clienteId}/declaraciones-anuales?declId=${id}`,
        { method: "DELETE" }
      );
      if (res.ok) setDecls((prev) => prev.filter((d) => d.id !== id));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const trabajando = busy !== null;
  const comp = compararAnual(decls);
  const cruceGuardado = decls.find((d) => d.ruc && d.ruc !== clienteRuc);

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">DJ Anual — comparativo año vs año</h2>
        <span className="badge bg-slate-100 text-slate-500">PDF · Formulario 710</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube las <strong>DJ anuales (710)</strong> de los años que quieras comparar. Cada PDF
        detecta su <strong>ejercicio</strong> y empresa solos; se arma el comparativo de{" "}
        <strong>Estados Financieros</strong> y <strong>Estado de Resultados</strong>, resaltando
        las variaciones más grandes.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && subir(e.target.files)}
        />
        <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={trabajando}>
          {busy === "upload" ? "Leyendo…" : "⬆ Subir DJ anual (una o varias)"}
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} />
          Modo diagnóstico
        </label>
      </div>

      {resumen && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{resumen}</div>
      )}
      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
      )}

      {/* Años cargados */}
      {decls.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {decls.map((d) => (
            <span
              key={d.id}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                d.ruc && d.ruc !== clienteRuc
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              <strong>{d.ejercicio}</strong>
              <span className="text-slate-400">{d.razonSocial ?? d.archivoNombre ?? "PDF"}</span>
              <button onClick={() => eliminar(d.id)} disabled={busy === "del"} title="Quitar" className="text-slate-400 hover:text-red-600">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {cruceGuardado && (
        <div className="mt-3 rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠ <strong>Posible cruce de información:</strong> una DJ cargada tiene RUC{" "}
          {cruceGuardado.ruc} ({cruceGuardado.razonSocial ?? "?"}), distinto al del cliente ({clienteRuc}).
          Verifica antes de usar el comparativo.
        </div>
      )}

      {/* Observaciones */}
      {comp.observaciones.length > 0 && (
        <div className="mt-5 rounded-lg border border-accent-300 bg-accent-50 p-4">
          <p className="mb-2 text-sm font-bold text-brand-800">📌 Observaciones — variaciones importantes</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-brand-900">
            {comp.observaciones.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Comparativo por sección */}
      {comp.secciones.map((sec) => (
        <div key={sec.titulo} className="mt-5">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-700">{sec.titulo}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="py-1">Concepto</th>
                  {comp.ejercicios.map((y) => (
                    <th key={y} className="py-1 text-right">{y}</th>
                  ))}
                  {comp.ejercicios.length >= 2 && (
                    <>
                      <th className="py-1 text-right">Variación</th>
                      <th className="py-1 text-right">%</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {sec.filas.map((f) => (
                  <tr
                    key={f.codigo}
                    className={`border-t border-slate-100 ${f.resaltar ? "bg-accent-50" : ""}`}
                  >
                    <td className="py-1 text-slate-600">
                      {f.resaltar && <span className="mr-1">🔶</span>}
                      {f.etiqueta} <span className="text-slate-300">[{f.codigo}]</span>
                    </td>
                    {comp.ejercicios.map((y) => (
                      <td key={y} className="py-1 text-right tabular-nums text-slate-700">
                        {fmtSoles(f.valores[y] ?? 0)}
                      </td>
                    ))}
                    {comp.ejercicios.length >= 2 && (
                      <>
                        <td
                          className={`py-1 text-right font-medium tabular-nums ${
                            f.variacion > 0 ? "text-emerald-600" : f.variacion < 0 ? "text-red-600" : "text-slate-400"
                          }`}
                        >
                          {f.variacion > 0 ? "+" : ""}{fmtSoles(f.variacion)}
                        </td>
                        <td className={`py-1 text-right tabular-nums ${f.resaltar ? "font-semibold text-brand-700" : "text-slate-400"}`}>
                          {f.porcentaje > 0 ? "+" : ""}{f.porcentaje.toFixed(0)}%
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {decls.length === 1 && (
        <p className="mt-4 text-sm text-slate-400">
          Sube al menos <strong>dos años</strong> para ver la comparación y las variaciones.
        </p>
      )}

      {diag && (
        <details className="mt-3" open>
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">
            Diagnóstico — año, RUC y casillas detectadas
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">
            {diag}
          </pre>
        </details>
      )}
    </section>
  );
}
