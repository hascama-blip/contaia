"use client";

import { useState } from "react";
import { getSolPass, getSolUser } from "@/lib/solSession";

// Descarga los XML de comprobantes RECIBIDOS (compras) desde SUNAT SOL a partir
// de la relación subida y los arma en un Excel (reusa el Excel de detalle de
// facturas XML). No pide mes/año: se descarga tal cual la relación, por orden y
// número de comprobante.
export default function ComprobantesXmlPanel({ clienteId }: { clienteId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [facturas, setFacturas] = useState<any[]>([]);
  const [relacion, setRelacion] = useState<any[]>([]);
  const [relNombre, setRelNombre] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<{ hechos: number; total: number } | null>(null);
  // Comprobantes que no se pudieron bajar + cuántos reintentos se han hecho.
  const [fallidos, setFallidos] = useState<any[]>([]);
  const [reintentos, setReintentos] = useState(0);

  const MAX_REINTENTOS = 2;
  // Tamaño de tanda: el frontend parte la relación y llama a la API por bloques
  // para que ninguna petición dure demasiado (proxy/timeout) y se vea el avance.
  const TANDA = 12;

  async function subirRelacion(file: File) {
    setError(null); setInfo(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/comprobantes-xml/parsear", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo leer la relación."); return; }
      setRelacion(data.items ?? []);
      setRelNombre(file.name);
      setInfo(`Relación cargada: ${data.total} comprobante(s) por descargar.`);
    } catch {
      setError("Error de red al subir la relación.");
    } finally {
      setBusy(false);
    }
  }

  async function llamarTanda(body: any) {
    const res = await fetch(`/api/clientes/${clienteId}/comprobantes-xml`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  /** Procesa una lista de comprobantes en tandas, acumulando sobre `acum` y
   *  devolviendo los que fallaron. `consumir` = si esta corrida gasta 1 consulta
   *  (solo la primera; los reintentos NO gastan). Lanza en 401/429 (cortan). */
  async function procesarLista(items: any[], acum: any[], consumir: boolean): Promise<any[]> {
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId);
    const total = items.length;
    const nuevosFallidos: any[] = [];
    // parte 0 = consume cupo. Para NO consumir (reintentos), empezamos en 1.
    let parte = consumir ? 0 : 1;
    let hechos = 0;
    setProgreso({ hechos: 0, total });
    for (let inicio = 0; inicio < total; inicio += TANDA, parte++) {
      // El bloque puede venir de la relación (ítems) o de la lista de fallidos
      // ({item, motivo}); normalizamos a ítem limpio antes de mandarlo.
      const bloque = items.slice(inicio, inicio + TANDA).map((it: any) => it.item ?? it);
      const { res, data } = await llamarTanda({ solUser, solPass, relacion: bloque, parte });
      if (res.status === 401) throw { corte: data.error ?? "SUNAT rechazó el inicio de sesión." };
      if (res.status === 429) throw { corte: data.error ?? "Sin consultas disponibles." };
      if (Array.isArray(data.facturas)) acum.push(...data.facturas);
      // Guardamos el fallo completo ({item, motivo}) para mostrarlo y reintentar.
      if (Array.isArray(data.fallidos)) nuevosFallidos.push(...data.fallidos);
      hechos += bloque.length;
      setFacturas([...acum]);
      setProgreso({ hechos: Math.min(hechos, total), total });
    }
    return nuevosFallidos;
  }

  async function extraer() {
    setError(null); setInfo(null); setDiag(null); setProgreso(null);
    setFallidos([]); setReintentos(0);
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId);
    if (!solPass) { setError("Carga tus accesos SOL (arriba) para descargar los XML."); return; }
    if (!relacion.length) { setError("Sube primero la relación de comprobantes (usa la plantilla)."); return; }
    setBusy(true);
    setFacturas([]);
    try {
      // Modo diagnóstico: una sola tanda chica (para calibrar sin ruido).
      if (diagModo) {
        const { res, data } = await llamarTanda({ solUser, solPass, relacion: relacion.slice(0, 3), diagnostico: true, parte: 0 });
        if (data.diag) setDiag(JSON.stringify(data.diag, null, 2));
        if (!res.ok) { setError(data.error ?? "No se pudo descargar los comprobantes."); return; }
        setFacturas(data.facturas ?? []);
        setInfo(`${data.descargados ?? 0} comprobante(s) descargado(s) (diagnóstico).`);
        return;
      }

      const total = relacion.length;
      const acum: any[] = [];
      const fallos = await procesarLista(relacion, acum, true);
      setFallidos(fallos);
      setInfo(
        `${acum.length} de ${total} comprobante(s) descargado(s).` +
        (fallos.length ? ` ${fallos.length} no se pudieron bajar (revisa la lista y reintenta).` : "")
      );
    } catch (e: any) {
      setError(e?.corte ?? "Error de red al descargar los comprobantes.");
    } finally {
      setBusy(false);
      setProgreso(null);
    }
  }

  /** Reintenta SOLO los comprobantes fallidos (máx. 2 veces, sin gastar cupo). */
  async function reintentar() {
    if (!fallidos.length || reintentos >= MAX_REINTENTOS) return;
    setError(null); setInfo(null);
    const pendientes = fallidos;
    setBusy(true);
    try {
      const acum = [...facturas];
      const fallos = await procesarLista(pendientes, acum, false);
      const intentoActual = reintentos + 1;
      setReintentos(intentoActual);
      setFacturas([...acum]);
      setFallidos(fallos);
      if (!fallos.length) {
        setInfo(`¡Listo! Se recuperaron los ${pendientes.length} pendiente(s). Total: ${acum.length}.`);
      } else if (intentoActual >= MAX_REINTENTOS) {
        setInfo(
          `Tras ${MAX_REINTENTOS} reintentos, ${fallos.length} comprobante(s) siguen sin descargar. ` +
          `Es un problema temporal de SUNAT (su portal no los está entregando): intenta más tarde o descárgalos manualmente.`
        );
      } else {
        setInfo(`Se recuperaron ${pendientes.length - fallos.length}; quedan ${fallos.length}. Puedes reintentar de nuevo.`);
      }
    } catch (e: any) {
      setError(e?.corte ?? "Error de red al reintentar.");
    } finally {
      setBusy(false);
      setProgreso(null);
    }
  }

  async function descargarExcel() {
    setBusy(true);
    try {
      const res = await fetch("/api/facturas-xml/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facturas, detalle: true }),
      });
      if (!res.ok) { setError("No se pudo generar el Excel."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "comprobantes-xml.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Comprobantes recibidos (XML) desde SUNAT</h2>
        <span className="badge bg-slate-100 text-slate-500">Solo Usuario + Clave SOL</span>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Sube la <strong>relación de comprobantes</strong> (con la plantilla). El sistema descarga sus
        <strong> XML de compras</strong> directo de SUNAT (Consulta de comprobantes, SEE-SOL), en el
        mismo orden y número que la relación, y los arma en un <strong>Excel</strong> con el detalle.
      </p>

      {/* Relación de comprobantes: descargar plantilla + subir la llena */}
      <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
        <p className="mb-2 text-xs font-semibold text-brand-800">Relación de comprobantes a descargar</p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/comprobantes-xml/plantilla"
            className="btn-ghost text-sm"
            download
          >
            ⬇ Descargar plantilla (Excel)
          </a>
          <label className={`btn-primary cursor-pointer text-sm ${busy ? "pointer-events-none opacity-50" : ""}`}>
            ⬆ Subir relación llena
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subirRelacion(f); e.currentTarget.value = ""; }}
            />
          </label>
          {relNombre && (
            <span className="text-xs text-emerald-700">
              ✓ {relNombre} · {relacion.length} comprobante(s)
              <button className="ml-2 text-slate-400 underline" onClick={() => { setRelacion([]); setRelNombre(null); }}>quitar</button>
            </span>
          )}
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          Descarga la plantilla, complétala (RUC emisor, tipo, serie, número, fecha, monto) y súbela.
          Se descargan tal cual, por orden y número de comprobante.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <button className="btn-primary" onClick={extraer} disabled={busy}>
          {busy
            ? progreso ? `Descargando ${progreso.hechos}/${progreso.total}…` : "Descargando…"
            : "⬇ Descargar XML de SUNAT"}
        </button>
        {facturas.length > 0 && (
          <button className="btn-ghost" onClick={descargarExcel} disabled={busy}>
            ⬇ Excel con el detalle
          </button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} />
          Modo diagnóstico
        </label>
      </div>

      {relacion.length > 0 && facturas.length === 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <div className="bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase text-slate-500">
            Relación cargada ({relacion.length}) — esto es lo que se descargará
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="px-3 py-1">RUC Emisor</th>
                <th className="px-3 py-1">Tipo</th>
                <th className="px-3 py-1">Serie</th>
                <th className="px-3 py-1">Número</th>
              </tr>
            </thead>
            <tbody>
              {relacion.slice(0, 12).map((r: any, i: number) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-1 text-slate-600">{r.rucEmisor}</td>
                  <td className="px-3 py-1 text-slate-600">{r.tipo}</td>
                  <td className="px-3 py-1 text-slate-600">{r.serie}</td>
                  <td className="px-3 py-1 text-slate-600">{r.numero}</td>
                </tr>
              ))}
              {relacion.length > 12 && (
                <tr><td className="px-3 py-1 text-slate-400" colSpan={4}>… y {relacion.length - 12} más</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {progreso && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>Descargando XML de SUNAT…</span>
            <span>{progreso.hechos}/{progreso.total}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{ width: `${Math.round((progreso.hechos / Math.max(1, progreso.total)) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            No cierres esta pestaña. Cada comprobante toma unos segundos; el total puede tardar varios minutos.
          </p>
        </div>
      )}

      {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      {/* Comprobantes que NO se pudieron descargar + reintento (máx. 2). */}
      {fallidos.length > 0 && !busy && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-amber-800">
              ⚠ {fallidos.length} comprobante(s) no se descargaron
            </p>
            {reintentos < MAX_REINTENTOS ? (
              <button className="btn-primary text-sm" onClick={reintentar} disabled={busy}>
                🔁 Reintentar los que faltan ({reintentos + 1}/{MAX_REINTENTOS})
              </button>
            ) : (
              <span className="badge bg-red-100 text-red-700">Sin más reintentos</span>
            )}
          </div>
          {reintentos >= MAX_REINTENTOS && (
            <p className="mt-2 text-xs text-red-700">
              Tras {MAX_REINTENTOS} reintentos siguen sin bajar. Es un <strong>problema temporal de SUNAT</strong>
              {" "}(su portal no los está entregando). Intenta más tarde o descárgalos manualmente.
            </p>
          )}
          <div className="mt-2 max-h-40 overflow-auto rounded border border-amber-200 bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-400">
                  <th className="px-2 py-1">RUC Emisor</th>
                  <th className="px-2 py-1">Tipo</th>
                  <th className="px-2 py-1">Serie-Número</th>
                  <th className="px-2 py-1">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {fallidos.map((f: any, i: number) => {
                  const it = f.item ?? f;
                  return (
                    <tr key={i} className="border-t border-amber-100">
                      <td className="px-2 py-1 text-slate-600">{it.rucEmisor}</td>
                      <td className="px-2 py-1 text-slate-600">{it.tipo}</td>
                      <td className="px-2 py-1 font-medium text-slate-700">{it.serie}-{it.numero}</td>
                      <td className="px-2 py-1 text-slate-500">{f.motivo ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {facturas.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="py-1">Serie-Número</th>
                <th className="py-1">Fecha</th>
                <th className="py-1">Proveedor</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {facturas.map((f, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-1 text-slate-600">{f.serieNumero}</td>
                  <td className="py-1 text-slate-500">{f.fecha}</td>
                  <td className="py-1 text-slate-600">{f.razonSocialEmisor || f.rucEmisor}</td>
                  <td className="py-1 text-right tabular-nums text-slate-700">{Number(f.total).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
