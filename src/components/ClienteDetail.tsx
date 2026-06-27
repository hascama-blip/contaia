"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Cliente } from "@/lib/types";
import SunatPanel from "./SunatPanel";
import AccesosSol from "./AccesosSol";
import BuzonPanel from "./BuzonPanel";
import EstadoSirePanel from "./EstadoSirePanel";
import DeclaracionesPanel from "./DeclaracionesPanel";
import DeclaracionesAnualesPanel from "./DeclaracionesAnualesPanel";
import DeudasF36Panel from "./DeudasF36Panel";
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

export default function ClienteDetail({
  inicial,
  puedeApi = true,
  puedeEliminar = false,
}: {
  inicial: Cliente;
  puedeApi?: boolean;
  puedeEliminar?: boolean;
}) {
  const router = useRouter();
  const [cliente, setCliente] = useState<Cliente>(inicial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  // Fechas que decolecta NO entrega: se ingresan a mano y se guardan.
  const [fInscripcion, setFInscripcion] = useState(inicial.sunat?.fechaInscripcion ?? "");
  const [fInicio, setFInicio] = useState(inicial.sunat?.fechaInicioActividades ?? "");

  async function guardarFechasSunat() {
    setBusy("fechas");
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/sunat`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fechaInscripcion: fInscripcion, fechaInicioActividades: fInicio }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { notify("err", data.error ?? "No se pudo guardar."); return; }
      setCliente(data.cliente);
      notify("ok", "Fechas SUNAT guardadas.");
      router.refresh();
    } finally { setBusy(null); }
  }

  async function eliminarCliente() {
    if (!window.confirm(`¿Eliminar la empresa "${cliente.razonSocial}" (RUC ${cliente.ruc})? Esta acción no se puede deshacer.`)) return;
    setBusy("del");
    try {
      const res = await fetch(`/api/clientes/${cliente.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { notify("err", data.error ?? "No se pudo eliminar la empresa."); return; }
      router.push("/clientes");
      router.refresh();
    } finally { setBusy(null); }
  }

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
        <div className="flex gap-2">
          {cliente.buzon && (
            <Link href={`/clientes/${cliente.id}/buzon`} className="btn-ghost">
              📨 Notificaciones (PDF)
            </Link>
          )}
          {d && (
            <Link href={`/clientes/${cliente.id}/informe`} className="btn-primary">
              📄 Generar informe
            </Link>
          )}
          {puedeEliminar && (
            <button
              onClick={eliminarCliente}
              disabled={busy === "del"}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              title="Eliminar esta empresa (solo líder/supremo)"
            >
              {busy === "del" ? "Eliminando…" : "🗑 Eliminar empresa"}
            </button>
          )}
        </div>
      </div>

      {/* Accesos SOL: se cargan 1 vez y los usan todos los módulos */}
      <AccesosSol clienteId={cliente.id} solUserGuardado={cliente.credSire?.solUser ?? ""} />

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
                <Field label="Domicilio fiscal" value={cliente.sunat.direccion} />
                {/* Fechas que decolecta no entrega: editables a mano (se guardan). */}
                <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-2 text-xs text-slate-500">
                    SUNAT (decolecta) no entrega estas fechas. Ingrésalas a mano (tal como en
                    Consulta RUC); se guardan y salen en el informe.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Fecha de inscripción</label>
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                        placeholder="dd/mm/aaaa"
                        value={fInscripcion}
                        onChange={(e) => setFInscripcion(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Inicio de actividades</label>
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                        placeholder="dd/mm/aaaa"
                        value={fInicio}
                        onChange={(e) => setFInicio(e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    onClick={guardarFechasSunat}
                    disabled={busy === "fechas"}
                    className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {busy === "fechas" ? "Guardando…" : "Guardar fechas"}
                  </button>
                </div>
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
                {cliente.sunat.representantes && cliente.sunat.representantes.length > 0 && (
                  <div className="sm:col-span-2">
                    <p className="mb-1 text-xs uppercase text-slate-400">
                      Representantes legales ({cliente.sunat.representantes.length})
                    </p>
                    <div className="overflow-hidden rounded-md border border-slate-200">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-400">
                          <tr>
                            <th className="px-2 py-1">Nombre</th>
                            <th className="px-2 py-1 whitespace-nowrap">Documento</th>
                            <th className="px-2 py-1">Cargo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {cliente.sunat.representantes.map((r, i) => (
                            <tr key={i}>
                              <td className="px-2 py-1 text-slate-700">{r.nombre}</td>
                              <td className="px-2 py-1 whitespace-nowrap text-slate-600">
                                {[r.tipoDoc, r.numeroDoc].filter(Boolean).join(" ")}
                              </td>
                              <td className="px-2 py-1 text-slate-500">{r.cargo ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
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

          {/* ───── 1 · Buzón electrónico (solo Usuario + Clave SOL) ───── */}
          <FaseHeader n="1" titulo="Buzón electrónico" detalle="Solo Usuario + Clave SOL." />

          <BuzonPanel
            clienteId={cliente.id}
            solUserGuardado={cliente.credSire?.solUser ?? ""}
            yaConsultado={Boolean(cliente.buzon)}
          />

          {/* ───── 2 · Estado SIRE (presentado / no presentado) ───── */}
          <FaseHeader n="2" titulo="Estado SIRE" detalle="Presentado / no presentado por periodo (rápido)." />

          <EstadoSirePanel clienteId={cliente.id} inicialCred={cliente.credSire ?? null} />

          {/* ───── 3 · Deudas (Fraccionamiento F36) — solo Usuario + Clave SOL ───── */}
          <FaseHeader n="3" titulo="Deudas (Fraccionamiento Art. 36)" detalle="Solo Usuario + Clave SOL." />

          <DeudasF36Panel
            clienteId={cliente.id}
            solUserGuardado={cliente.credSire?.solUser ?? ""}
            inicial={cliente.deudasF36 ?? null}
          />

          {/* ───── 4 · Extracción SIRE (montos) — requiere API ───── */}
          <FaseHeader n="4" titulo="Extracción SIRE (montos)" detalle="Coloca y bloquea la API para sacar compras/ventas." />

          <SunatPanel
            clienteId={cliente.id}
            inicialSire={cliente.sire ?? []}
            inicialCred={cliente.credSire ?? null}
            puedeApi={puedeApi}
          />

          {/* ───── 5 · Comparativo mensual (DJ 621 vs SIRE) ───── */}
          <FaseHeader n="5" titulo="Comparativo mensual" detalle="Sube el PDF de la DJ mensual (621) vs SIRE." />

          <DeclaracionesPanel
            clienteId={cliente.id}
            inicialDeclaraciones={cliente.declaraciones ?? []}
            inicialSire={cliente.sire ?? []}
          />

          {/* ───── 6 · Comparativo anual (subida de PDF) ───── */}
          <FaseHeader n="6" titulo="Comparativo anual" detalle="Sube el PDF de la DJ anual (Formulario 710)." />

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

function FaseHeader({ n, titulo, detalle }: { n: string; titulo: string; detalle: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
        {n}
      </span>
      <div>
        <h2 className="font-semibold text-slate-800">{titulo}</h2>
        <p className="text-xs text-slate-500">{detalle}</p>
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
