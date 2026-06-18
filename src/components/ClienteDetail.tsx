"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Cliente } from "@/lib/types";
import SunatPanel from "./SunatPanel";
import DeclaracionesPanel from "./DeclaracionesPanel";
import DeclaracionesAnualesPanel from "./DeclaracionesAnualesPanel";
import {
  CondicionBadge,
  EstadoBadge,
  RiesgoBadge,
  fmtFecha,
} from "./ui";

const SEV_STYLE: Record<string, string> = {
  bajo: "border-l-emerald-400 bg-emerald-50",
  medio: "border-l-amber-400 bg-amber-50",
  alto: "border-l-orange-400 bg-orange-50",
  critico: "border-l-red-400 bg-red-50",
};

export default function ClienteDetail({ inicial }: { inicial: Cliente }) {
  const router = useRouter();
  const [cliente, setCliente] = useState<Cliente>(inicial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function notify(type: "ok" | "err", text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function refresh() {
    const res = await fetch(`/api/clientes/${cliente.id}`);
    if (res.ok) {
      const data = await res.json();
      setCliente(data.cliente);
    }
    router.refresh();
  }

  async function consultarSunat() {
    setBusy("sunat");
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/sunat`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) return notify("err", data.error ?? "Error consultando SUNAT");
      setCliente(data.cliente);
      notify("ok", `Estado SUNAT actualizado (${data.sunat.fuente}).`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function generarDiagnostico() {
    setBusy("diag");
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/diagnostico`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) return notify("err", data.error ?? "Error generando diagnóstico");
      setCliente(data.cliente);
      notify("ok", "Diagnóstico generado.");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const d = cliente.diagnostico;

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`rounded-lg px-4 py-2 text-sm ${
            msg.type === "ok"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/clientes" className="text-sm text-brand-600 hover:underline">
            ← Clientes
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-800">
            {cliente.razonSocial}
          </h1>
          <p className="text-sm text-slate-500">
            RUC {cliente.ruc}
            {cliente.email && <> · {cliente.email}</>}
            {cliente.telefono && <> · {cliente.telefono}</>}
          </p>
        </div>
        {d && (
          <Link href={`/clientes/${cliente.id}/informe`} className="btn-primary">
            📄 Generar informe
          </Link>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Columna izquierda: SUNAT + documentos */}
        <div className="space-y-6 lg:col-span-2">
          {/* SUNAT */}
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Estado tributario SUNAT</h2>
              <button
                className="btn-ghost"
                onClick={consultarSunat}
                disabled={busy === "sunat"}
              >
                {busy === "sunat"
                  ? "Consultando…"
                  : cliente.sunat
                    ? "Actualizar"
                    : "Consultar SUNAT"}
              </button>
            </div>
            {cliente.sunat ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Razón social SUNAT" value={cliente.sunat.razonSocial} />
                <Field label="Tipo" value={cliente.sunat.tipoContribuyente} />
                <div>
                  <p className="text-xs uppercase text-slate-400">Estado</p>
                  <EstadoBadge estado={cliente.sunat.estado} />
                </div>
                <div>
                  <p className="text-xs uppercase text-slate-400">Condición domicilio</p>
                  <CondicionBadge condicion={cliente.sunat.condicion} />
                </div>
                <Field
                  label="Comprobante electrónico"
                  value={cliente.sunat.comprobanteElectronico ? "Sí" : "No"}
                />
                <Field label="Dirección" value={cliente.sunat.direccion} />
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase text-slate-400">Tributos / régimen</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {cliente.sunat.tributos.map((t) => (
                      <span key={t} className="badge bg-slate-100 text-slate-600">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-400 sm:col-span-2">
                  Fuente: {cliente.sunat.fuente} · {fmtFecha(cliente.sunat.consultadoAt)}
                </p>
              </div>
            ) : (
              <p className="py-4 text-sm text-slate-400">
                Aún no se ha consultado el estado en SUNAT.
              </p>
            )}
          </section>

          {/* Consulta SUNAT unificada: SIRE + Buzón con una sola credencial */}
          <SunatPanel clienteId={cliente.id} inicialSire={cliente.sire ?? []} />

          {/* Declaraciones mensuales (PDF) comparadas contra el SIRE */}
          <DeclaracionesPanel
            clienteId={cliente.id}
            inicialDeclaraciones={cliente.declaraciones ?? []}
            inicialSire={cliente.sire ?? []}
          />

          {/* DJ anual (Formulario 710): comparativo año vs año */}
          <DeclaracionesAnualesPanel
            clienteId={cliente.id}
            clienteRuc={cliente.ruc}
            inicial={cliente.declaracionesAnuales ?? []}
          />
        </div>

        {/* Columna derecha: diagnóstico */}
        <div className="space-y-6">
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Diagnóstico</h2>
              <button
                className="btn-ghost"
                onClick={generarDiagnostico}
                disabled={busy === "diag"}
              >
                {busy === "diag" ? "Analizando…" : d ? "Regenerar" : "Generar"}
              </button>
            </div>

            {!d ? (
              <p className="py-4 text-sm text-slate-400">
                Genera el diagnóstico para evaluar la salud tributaria combinando SUNAT y
                documentos.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <ScoreRing score={d.score} />
                  <RiesgoBadge nivel={d.nivelRiesgo} />
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                    Hallazgos ({d.hallazgos.length})
                  </p>
                  <ul className="space-y-2">
                    {d.hallazgos.map((h, i) => (
                      <li
                        key={i}
                        className={`rounded-md border-l-4 p-2 text-sm ${SEV_STYLE[h.severidad]}`}
                      >
                        <p className="font-medium text-slate-800">{h.titulo}</p>
                        <p className="text-xs text-slate-600">{h.detalle}</p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-slate-400">
                    Recomendaciones
                  </p>
                  <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
                    {d.recomendaciones.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>

                <p className="text-xs text-slate-400">
                  Generado: {fmtFecha(d.generatedAt)}
                </p>
                <Link
                  href={`/clientes/${cliente.id}/informe`}
                  className="btn-primary w-full"
                >
                  📄 Ver / imprimir informe
                </Link>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p className="text-sm text-slate-700">{value || "—"}</p>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 85
      ? "#10b981"
      : score >= 65
        ? "#f59e0b"
        : score >= 40
          ? "#f97316"
          : "#ef4444";
  const deg = (score / 100) * 360;
  return (
    <div
      className="grid h-24 w-24 place-items-center rounded-full"
      style={{ background: `conic-gradient(${color} ${deg}deg, #e2e8f0 ${deg}deg)` }}
    >
      <div className="grid h-[72px] w-[72px] place-items-center rounded-full bg-white">
        <span className="text-xl font-bold text-slate-800">{score}</span>
        <span className="text-[10px] text-slate-400">/100</span>
      </div>
    </div>
  );
}
