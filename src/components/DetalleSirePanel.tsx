"use client";

import { useRef, useState } from "react";
import { usePuedeDiag } from "./SupremoContext";
import { getSolPass, getSolUser } from "@/lib/solSession";
import TiempoAprox, { TIEMPOS } from "./TiempoAprox";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];

// Extrae el DETALLE SIRE (propuesta comprobante por comprobante) de un periodo
// desde la API oficial de SUNAT y lo muestra en tabla + Excel. `tipo` fija si
// es Ventas (RVIE) o Compras (RCE) — cada módulo trabaja uno solo.
export default function DetalleSirePanel({ clienteId, tipo, periodoInicial }: { clienteId: string; tipo: "ventas" | "compras"; periodoInicial?: string }) {
  const esVentas = tipo === "ventas";
  const libro = esVentas ? "RVIE (ventas)" : "RCE (compras)";
  const hoy = new Date();
  const [mes, setMes] = useState(periodoInicial ? Number(periodoInicial.slice(4, 6)) : hoy.getMonth() + 1);
  const [anio, setAnio] = useState(periodoInicial ? Number(periodoInicial.slice(0, 4)) : hoy.getFullYear());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [diagModo, setDiagModo] = useState(false);
  const puedeDiag = usePuedeDiag(); // el Modo diagnóstico solo lo ve el supremo
  const [refrescar, setRefrescar] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [bloque, setBloque] = useState<any>(null);
  // Ventana de aviso cuando SUNAT demora: "esperando" = seguimos reintentando solos;
  // "sigue" = se agotaron los reintentos (el pedido queda en curso en SUNAT).
  const [demora, setDemora] = useState<null | "esperando" | "sigue">(null);
  const [sunatAcepto, setSunatAcepto] = useState(false); // SUNAT ya recibió el pedido (respondió "en proceso")
  const avisoCerrado = useRef(false); // si la cerró con "Entendido", no se reabre en esta extracción
  const avisarDemora = (estado: "esperando" | "sigue") => {
    if (estado === "sigue") { avisoCerrado.current = false; setDemora("sigue"); return; }
    if (!avisoCerrado.current) setDemora("esperando");
  };

  async function extraer() {
    setError(null); setInfo(null); setDiag(null); setBloque(null);
    setDemora(null); avisoCerrado.current = false; setSunatAcepto(false);
    const solPass = getSolPass(clienteId);
    const solUser = getSolUser(clienteId);
    // Con caché no hace falta la Clave SOL; sin caché (o refrescar) sí.
    const periodo = `${anio}${String(mes).padStart(2, "0")}`;
    setBusy(true);
    // La propuesta SIRE es ASÍNCRONA: SUNAT genera el reporte en segundo plano
    // (ticket "En proceso"). Si aún no está, el backend responde { pendiente } y
    // acá reintentamos solo (cada intento reusa el mismo ticket vía 42209).
    // Cada intento ya espera ~95 s en el backend (poll del ticket); con esto
    // aguantamos hasta que SUNAT termine (en la práctica 1–3 intentos).
    const MAX_REINTENTOS = 8;
    const ESPERA_MS = 8000;
    // Cortes de conexión seguidos que se toleran (con SUNAT lento el pedido tarda y a
    // veces la conexión se corta): se reintenta solo; SUNAT retoma el mismo pedido.
    const MAX_CORTES = 3;
    const MSG_DEMORA = "Por demoras de carga de SUNAT, las descargas del SIRE se están demorando.";
    const esDemoraSunat = (t: string) => /fetch failed|timed? ?out|tiempo de espera|ETIMEDOUT|ECONNRESET|socket|HTTP 5\d\d|\b50[234]\b|\b429\b|Too Many Requests|limit[oó] las solicitudes/i.test(t);
    let cortes = 0;
    try {
      for (let intento = 0; intento <= MAX_REINTENTOS; intento++) {
        let res: Response;
        try {
          res = await fetch(`/api/clientes/${clienteId}/sire-detalle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ solUser, solPass, periodo, incluirVentas: esVentas, incluirCompras: !esVentas, diagnostico: diagModo, refrescar }),
          });
        } catch {
          // Se cortó la conexión mientras SUNAT preparaba el archivo: avisar y reintentar.
          cortes++;
          if (cortes <= MAX_CORTES && intento < MAX_REINTENTOS) {
            avisarDemora("esperando");
            setInfo(`⏳ SUNAT está demorando la propuesta de ${libro}… reintentando automáticamente (${intento + 1}/${MAX_REINTENTOS}).`);
            await new Promise((r) => setTimeout(r, ESPERA_MS));
            continue;
          }
          avisarDemora("sigue");
          setInfo(null);
          setError(`${MSG_DEMORA} Vuelve a pulsar Extraer en unos minutos.`);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (diagModo && data.diag) setDiag(JSON.stringify(data.diag, null, 2));
        if (res.status === 400 && !solPass && !data.desdeCache) {
          setError("No hay datos guardados de este periodo. Carga tus accesos SOL (arriba) para extraerlo de SUNAT.");
          return;
        }
        if (!res.ok) {
          const msg = String(data.error ?? "");
          // Sin respuesta del servidor (502/504) o SUNAT lento/saturado: es demora, no un error de datos.
          if (res.status >= 502 || esDemoraSunat(msg)) {
            avisarDemora("sigue");
            setInfo(null);
            setError(`${MSG_DEMORA}${msg ? ` (${msg})` : ""} Vuelve a pulsar Extraer en unos minutos.`);
            return;
          }
          setError(msg || "No se pudo extraer el detalle.");
          return;
        }
        cortes = 0;
        // SUNAT aún genera el reporte → reintentar (reusa el ticket en curso).
        if (data.pendiente) {
          setSunatAcepto(true);
          if (intento < MAX_REINTENTOS) {
            if (intento >= 1) avisarDemora("esperando"); // ya van varios minutos esperando a SUNAT
            setInfo(`⏳ SUNAT está generando la propuesta de ${libro}… reintentando automáticamente (${intento + 1}/${MAX_REINTENTOS}).`);
            await new Promise((r) => setTimeout(r, ESPERA_MS));
            continue;
          }
          avisarDemora("sigue");
          setInfo(null);
          setError("SUNAT sigue generando el reporte tras varios minutos. Su ticket ya está en curso: espera un momento y vuelve a pulsar Extraer (lo retomará).");
          return;
        }
        setDemora(null);
        const b = esVentas ? data.ventas : data.compras;
        setBloque(b ?? null);
        if (diagModo) { setInfo("Diagnóstico listo (revisa la traza cruda abajo)."); return; }
        const desde = data.desdeCache
          ? ` · guardado (${new Date(data.cacheAt).toLocaleString("es-PE")}) — no se reconsultó SUNAT`
          : " · recién extraído de SUNAT (guardado en caché)";
        setInfo(`${b?.comprobantes ?? 0} comprobante(s) de ${libro}${desde}.`);
        return;
      }
    } catch {
      avisarDemora("sigue");
      setError(`${MSG_DEMORA} Vuelve a pulsar Extraer en unos minutos.`);
    } finally {
      setBusy(false);
    }
  }

  async function descargar(endpoint: string, nombre: string, extra: any = {}) {
    const periodo = `${anio}${String(mes).padStart(2, "0")}`;
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodo, ...extra }),
      });
      if (!res.ok) { setError("No se pudo generar el archivo."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nombre.replace("{periodo}", periodo);
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const descargarExcel = () =>
    descargar("/api/sire-detalle/excel", `detalle-sire-${tipo}-{periodo}.xlsx`, {
      ventas: esVentas ? bloque : undefined, compras: esVentas ? undefined : bloque,
    });
  // Plantilla de relación (formato Comprobantes XML) para las compras.
  const descargarPlantilla = () =>
    descargar("/api/sire-detalle/plantilla", `relacion-comprobantes-{periodo}.xlsx`, { compras: bloque });

  const anios = [hoy.getFullYear(), hoy.getFullYear() - 1, hoy.getFullYear() - 2];
  const hayDatos = (bloque?.filas?.length ?? 0) > 0;

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Detalle SIRE — {esVentas ? "Ventas (RVIE)" : "Compras (RCE)"}</h2>
        <TiempoAprox tiempo={TIEMPOS.detalleSire} />
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Extrae el <strong>detalle comprobante por comprobante</strong> de la propuesta SUNAT de
        <strong> {libro}</strong> vía la API oficial, y descárgalo en <strong>Excel</strong>.
        Requiere tus accesos SOL y las credenciales de la app SIRE ya guardadas. Lo extraído se
        <strong> guarda en caché</strong>: si vuelves a consultar el mismo periodo no se re-pregunta a
        SUNAT (marca <strong>🔄 Refrescar</strong> para forzar una nueva consulta).
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Mes</label>
          <select className="input" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Año</label>
          <select className="input" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {anios.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button className="btn-primary" onClick={extraer} disabled={busy}>
          {busy ? "Extrayendo…" : `⬇ Extraer ${esVentas ? "ventas" : "compras"}`}
        </button>
        {hayDatos && (
          <button className="btn-ghost" onClick={descargarExcel} disabled={busy}>⬇ Excel</button>
        )}
        {!esVentas && hayDatos && (
          <button className="btn-ghost" onClick={descargarPlantilla} disabled={busy} title="Excel con el formato de la plantilla para subir al módulo de Descarga masiva de comprobantes">
            ⬇ Plantilla para XML
          </button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500" title="Vuelve a consultar SUNAT en vez de usar lo guardado">
          <input type="checkbox" checked={refrescar} onChange={(e) => setRefrescar(e.target.checked)} /> 🔄 Refrescar
        </label>
        {puedeDiag && (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={diagModo} onChange={(e) => setDiagModo(e.target.checked)} /> Modo diagnóstico
          </label>
        )}
      </div>

      {info && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{info}</div>}
      {!esVentas && hayDatos && (
        <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2 text-xs text-brand-800">
          ➡ Esta relación queda guardada. Para bajar los <strong>XML con glosa</strong> de estas compras, ve a{" "}
          <a href="/herramientas/comprobantes-xml" className="font-semibold underline">Descarga masiva de comprobantes</a>,
          elige esta empresa y pulsa <strong>“📋 Cargar del SIRE”</strong> con este mismo periodo.
        </div>
      )}
      {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}
      {diag && <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{diag}</pre>}

      <TablaDetalle titulo={esVentas ? "Ventas (RVIE)" : "Compras (RCE)"} bloque={bloque} />

      {/* Aviso de demora de SUNAT (ventana) */}
      {demora && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-900/60 p-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="demora-sunat-titulo">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-100 text-xl">⏳</span>
              <h3 id="demora-sunat-titulo" className="text-lg font-bold text-slate-800">SUNAT está demorando</h3>
            </div>
            <p className="mt-3 text-sm text-slate-700">
              Por demoras de carga de SUNAT, las descargas del SIRE se están demorando.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {demora === "esperando"
                ? "Seguimos intentando automáticamente. No cierres esta pestaña: el pedido ya está en curso en SUNAT y la descarga continuará sola."
                : sunatAcepto
                  ? "SUNAT aún no entrega el archivo. Vuelve a pulsar «Extraer» en unos minutos: el pedido ya está en curso y se retomará donde quedó."
                  : "SUNAT no está respondiendo en este momento. Vuelve a pulsar «Extraer» en unos minutos."}
            </p>
            {sunatAcepto && <p className="mt-2 text-xs text-slate-400">SUNAT ya aceptó tus accesos y recibió el pedido; solo falta que entregue el archivo.</p>}
            <button className="btn-primary mt-4 w-full" onClick={() => { avisoCerrado.current = true; setDemora(null); }}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function TablaDetalle({ titulo, bloque }: { titulo: string; bloque: any }) {
  if (!bloque || !(bloque.columnas?.length)) return null;
  const filas = bloque.filas ?? [];
  return (
    <div className="mt-4">
      <p className="mb-1 text-sm font-semibold text-slate-700">{titulo} <span className="text-xs font-normal text-slate-400">· {filas.length} comprobante(s)</span></p>
      <div className="max-h-96 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-left text-[10px] uppercase text-slate-400">
              {bloque.columnas.map((c: string, i: number) => <th key={i} className="whitespace-nowrap px-2 py-1">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, 300).map((f: string[], i: number) => (
              <tr key={i} className="border-t border-slate-100">
                {bloque.columnas.map((_: string, j: number) => (
                  <td key={j} className="whitespace-nowrap px-2 py-1 text-slate-600">{f[j] ?? ""}</td>
                ))}
              </tr>
            ))}
            {filas.length > 300 && (
              <tr><td className="px-2 py-1 text-slate-400" colSpan={bloque.columnas.length}>… y {filas.length - 300} más (descárgalos en Excel)</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
