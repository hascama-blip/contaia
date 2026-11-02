"use client";

import { useEffect, useState } from "react";

// Dashboard ISSOSOMA — look del "Dashboard de Operaciones" (navarro). Lee el
// análisis de /api/issosoma: costo por proyecto (bitácoras) + venta (facturas) =
// costo/beneficio. El recálculo (POST) recorre Drive y puede tardar; se cachea.

type Proyecto = { codigo: string; cliente: string; carpeta: string; venta: number; importeFacturado: number; costo: number; costoLogistica: number; utilidad: number; margen: number; saldo: number; nFacturas: number };
type Factura = { codigo: string; cliente: string; valorVenta: number; importeTotal: number; detalle: string; archivo: string };
type Gasto = { codigo: string; cliente: string; fecha: string; descripcion: string; monto: number };
type Analisis = {
  configurado: boolean; faltan?: string[]; cuentaServicio?: string;
  kpis: { venta: number; costo: number; utilidad: number; margen: number; proyectos: number; proyectosConVenta: number };
  proyectos: Proyecto[]; facturas: Factura[]; gastos: Gasto[]; avisos: string[];
  generadoAt: string; error?: string;
};

const VISTAS = [
  { id: "resumen", label: "Resumen" },
  { id: "proyectos", label: "Costo / Beneficio" },
  { id: "gastos", label: "Relación de gastos" },
  { id: "facturas", label: "Facturas (ventas)" },
  { id: "conexion", label: "Conexión / Recalcular" },
] as const;
type VistaId = (typeof VISTAS)[number]["id"];

const S = (n: number) => "S/ " + (n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = (n: number) => (n * 100).toFixed(1) + "%";
const claseMargen = (m: number) => (m >= 0.3 ? "st-good" : m >= 0.1 ? "st-warn" : "st-crit");

export default function IssosomaDashboard() {
  const [data, setData] = useState<Analisis | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recalc, setRecalc] = useState(false);
  const [vista, setVista] = useState<VistaId>("resumen");
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");

  async function cargar() {
    setCargando(true);
    try { const r = await fetch("/api/issosoma", { cache: "no-store" }); setData(await r.json()); }
    catch { setData(null); } finally { setCargando(false); }
  }
  async function recalcular() {
    setRecalc(true);
    try { const r = await fetch("/api/issosoma", { method: "POST" }); const d = await r.json(); if (!d.error) setData(d); else setData((p) => p ? { ...p, error: d.error } : p); }
    catch { /* */ } finally { setRecalc(false); }
  }
  useEffect(() => { cargar(); }, []);

  const k = data?.kpis;
  const vistaActual = VISTAS.find((v) => v.id === vista)!;
  const proyectos = (data?.proyectos ?? []).filter((p) => !q || `${p.codigo} ${p.cliente} ${p.carpeta}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="iss">
      <style>{CSS}</style>
      <div className="app">
        <aside className={`side ${menu ? "open" : ""}`}>
          <div className="brand">
            <div className="logo">IS</div>
            <div><b>ISSOSOMA</b><small>Costo · Beneficio · Viáticos</small></div>
            <button className="side-close" onClick={() => setMenu(false)} aria-label="Cerrar">✕</button>
          </div>
          <div className="nav-lbl">Panel</div>
          <nav id="nav">
            {VISTAS.map((v) => (
              <button key={v.id} className={`grp-btn ${vista === v.id ? "cur" : ""}`} onClick={() => { setVista(v.id); setMenu(false); }}>
                <span className="gt">{v.label}</span>
              </button>
            ))}
          </nav>
          <div className="side-foot">
            <span>{data?.generadoAt ? "Datos: " + new Date(data.generadoAt).toLocaleString("es-PE") : ""}</span>
            <button onClick={recalcular} disabled={recalc}>{recalc ? "…" : "Recalcular"}</button>
          </div>
        </aside>
        {menu && <div className="scrim" onClick={() => setMenu(false)} />}

        <main className="main">
          <div className="topbar"><div className="topbar-in">
            <button className="menu-btn" onClick={() => setMenu(true)}>☰ Menú</button>
            <div className="crumbs"><span>ISSOSOMA</span> · <span>{vistaActual.label}</span></div>
            <div className="tb-right">
              <span className="conn"><span className="sdot" data-st={data?.configurado ? "" : "off"} />
                <span><b>{data?.configurado ? "Conectado a Drive" : "Sin conectar"}</b>
                  <small>{data?.cuentaServicio || (cargando ? "cargando…" : "configura el acceso")}</small></span></span>
            </div>
          </div></div>

          <div className="main-in">
            {cargando && <div className="card">Cargando ISSOSOMA…</div>}
            {recalc && <div className="card warn-note">⏳ Recalculando desde Drive (bitácoras + facturas)… puede tardar unos minutos. Al terminar queda cacheado.</div>}
            {!cargando && data && data.error && <div className="card crit-note">⚠ {data.error}</div>}
            {!cargando && data && !data.configurado && <Conexion data={data} onRecalc={recalcular} recalc={recalc} />}

            {!cargando && data && data.configurado && k && (
              <>
                {vista === "resumen" && (
                  <div className="view">
                    <div className="page-head"><h1>Costo / Beneficio — resumen</h1>
                      <p className="sub-desc">Venta (facturas) vs costo (bitácoras) de {k.proyectos} proyecto(s) · {k.proyectosConVenta} con venta registrada.</p></div>
                    <div className="grid kpis">
                      <Kpi lbl="Venta" dot="var(--good)" val={S(k.venta)} />
                      <Kpi lbl="Costo" dot="var(--crit)" val={S(k.costo)} />
                      <Kpi lbl="Utilidad" dot="var(--exe)" val={S(k.utilidad)} foot={`Margen ${PCT(k.margen)}`} />
                      <Kpi lbl="Proyectos" dot="var(--warn)" val={String(k.proyectos)} foot={`${k.proyectosConVenta} con venta`} />
                    </div>
                    <div className="card"><div className="card-head"><div><h2>Top proyectos por utilidad</h2></div></div>
                      <BarrasH filas={[...data.proyectos].sort((a, b) => b.utilidad - a.utilidad).slice(0, 12).map((p) => ({ label: `${p.codigo} ${p.cliente}`.trim(), val: p.utilidad }))} color="var(--exe)" />
                    </div>
                    {data.avisos?.length ? <div className="card warn-note"><b>Avisos:</b> {data.avisos.join(" · ")}</div> : null}
                  </div>
                )}

                {vista === "proyectos" && (
                  <div className="view">
                    <div className="page-head"><h1>Costo / Beneficio por proyecto</h1></div>
                    <div className="filters"><input type="search" placeholder="Buscar código, cliente…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="count"><b>{proyectos.length}</b> proyecto(s)</span></div>
                    <div className="card"><div className="tbl-wrap tall"><table>
                      <thead><tr><th>Código</th><th>Cliente / carpeta</th><th className="num">Venta</th><th className="num">Costo</th><th className="num">Utilidad</th><th className="num">Margen</th><th className="num">Saldo</th><th className="num">FE</th></tr></thead>
                      <tbody>{proyectos.map((p) => (
                        <tr key={p.codigo + p.carpeta}>
                          <td className="cd">{p.codigo}</td>
                          <td>{p.cliente || p.carpeta || "—"}</td>
                          <td className="num">{S(p.venta)}</td>
                          <td className="num">{S(p.costo)}</td>
                          <td className="num">{S(p.utilidad)}</td>
                          <td className="num">{p.venta ? <span className={`chip ${claseMargen(p.margen)}`}><span className="ic">{p.margen >= 0.3 ? "✓" : p.margen >= 0.1 ? "!" : "✕"}</span>{PCT(p.margen)}</span> : "—"}</td>
                          <td className="num">{S(p.saldo)}</td>
                          <td className="num">{p.nFacturas || "—"}</td>
                        </tr>
                      ))}{!proyectos.length && <tr><td colSpan={8}>Sin proyectos (recalcula desde Drive).</td></tr>}</tbody>
                    </table></div></div>
                  </div>
                )}

                {vista === "gastos" && (
                  <div className="view">
                    <div className="page-head"><h1>Relación de gastos operativos</h1><p className="sub-desc">Gastos de las bitácoras por proyecto.</p></div>
                    <div className="card"><div className="tbl-wrap tall"><table>
                      <thead><tr><th>Código</th><th>Cliente</th><th>Fecha</th><th>Descripción</th><th className="num">Monto</th></tr></thead>
                      <tbody>{(data.gastos ?? []).map((g, i) => (
                        <tr key={i}><td className="cd">{g.codigo}</td><td>{g.cliente}</td><td className="cd">{g.fecha}</td><td className="wrapc">{g.descripcion}</td><td className="num">{S(g.monto)}</td></tr>
                      ))}{!data.gastos?.length && <tr><td colSpan={5}>Sin gastos operativos detallados.</td></tr>}</tbody>
                    </table></div></div>
                  </div>
                )}

                {vista === "facturas" && (
                  <div className="view">
                    <div className="page-head"><h1>Facturas de venta</h1><p className="sub-desc">{data.facturas.length} factura(s) electrónica(s) leídas de la carpeta de ventas.</p></div>
                    <div className="card"><div className="tbl-wrap tall"><table>
                      <thead><tr><th>Código</th><th>Cliente</th><th>Detalle</th><th className="num">Valor venta</th><th className="num">Importe total</th></tr></thead>
                      <tbody>{data.facturas.map((f, i) => (
                        <tr key={i}><td className="cd">{f.codigo || "—"}</td><td>{f.cliente || "—"}</td><td className="wrapc">{f.detalle}</td><td className="num">{S(f.valorVenta)}</td><td className="num">{S(f.importeTotal)}</td></tr>
                      ))}{!data.facturas.length && <tr><td colSpan={5}>Sin facturas (revisa ISSOSOMA_VENTAS_FOLDER_ID).</td></tr>}</tbody>
                    </table></div></div>
                  </div>
                )}

                {vista === "conexion" && <Conexion data={data} onRecalc={recalcular} recalc={recalc} />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Kpi({ lbl, dot, val, foot }: { lbl: string; dot: string; val: string; foot?: string }) {
  return (<div className="card kpi"><div className="lbl"><span className="dot" style={{ background: dot }} />{lbl}</div><div className="val">{val}</div>{foot && <div className="foot">{foot}</div>}</div>);
}
function BarrasH({ filas, color }: { filas: { label: string; val: number }[]; color: string }) {
  const top = filas.filter((f) => f.label);
  if (!top.length) return <div className="hint">Sin datos.</div>;
  const max = Math.max(1, ...top.map((f) => Math.abs(f.val)));
  return (<div className="hbars">{top.map((f, i) => (
    <div className="hbar" key={i}><span className="hlbl" title={f.label}>{f.label}</span>
      <span className="htrack"><i style={{ width: `${(Math.abs(f.val) / max) * 100}%`, background: f.val < 0 ? "var(--crit)" : color }} /></span>
      <span className="hval">{S(f.val)}</span></div>
  ))}</div>);
}
function Conexion({ data, onRecalc, recalc }: { data: Analisis; onRecalc: () => void; recalc: boolean }) {
  return (
    <div className="view">
      <div className="page-head"><h1>Conexión de datos</h1><p className="sub-desc">ISSOSOMA lee por <b>cuenta de servicio</b> dos carpetas de Drive (solo lectura): proyectos (bitácoras) y ventas (facturas).</p></div>
      {!data.configurado && (
        <div className="card warn-note"><h2>Falta configurar el acceso</h2>
          <ol className="steps">
            <li><b>GOOGLE_SERVICE_ACCOUNT_JSON</b> — JSON de una cuenta de servicio (API de Drive habilitada).</li>
            <li><b>ISSOSOMA_DRIVE_FOLDER_ID</b> — carpeta de PROYECTOS (la de las bitácoras).</li>
            <li><b>ISSOSOMA_VENTAS_FOLDER_ID</b> — carpeta de VENTAS (facturas electrónicas).</li>
            <li>Compartir <b>ambas</b> carpetas (como Lector) con el <code>client_email</code> de la cuenta de servicio.</li>
          </ol>
          {data.faltan?.length ? <p className="hint">Pendiente: <b>{data.faltan.join(", ")}</b>.</p> : null}
        </div>
      )}
      <div className="card"><div className="card-head"><div><h2>Recalcular desde Drive</h2>
        <div className="hint">Recorre todas las bitácoras y facturas (puede tardar unos minutos). El resultado queda cacheado y el tablero carga al instante.</div></div>
        <button className="btn-cta" onClick={onRecalc} disabled={recalc || !data.configurado}>{recalc ? "Recalculando…" : "↻ Recalcular ahora"}</button></div>
        {data.cuentaServicio && <p className="hint">Cuenta de servicio: <code>{data.cuentaServicio}</code></p>}
        {data.avisos?.length ? <p className="hint">⚠ {data.avisos.join(" · ")}</p> : null}
      </div>
    </div>
  );
}

const CSS = `
.iss{--bg:#dcd8ce;--card:#fff;--ink:#22302a;--ink2:#4f5c55;--muted:#7a847d;--line:#d2cdc2;--grid:#ebe7de;--hover:#f4f2ec;--head:#2f4a3b;--head-ink:#fff;--exe:#2f5a43;--good:#4e8a3e;--warn:#d1a12a;--crit:#b5483b;--neutral:#a8a397;--good-bg:#e2eedb;--warn-bg:#f8eed2;--crit-bg:#f5dfda;--neutral-bg:#ece9e2;--exe-soft:#d3dfcc;--shadow:0 1px 2px rgba(34,48,42,.07),0 2px 8px rgba(34,48,42,.06);--side-bg:#26402f;--side-ink:#fff;--side-ink2:#c3cfbf;--side-line:rgba(255,255,255,.13);--side-hover:rgba(255,255,255,.08);--side-act:rgba(255,255,255,.17);--brand-soft:#cfdac4;--brand-soft-ink:#22302a;--scrim:rgba(20,30,24,.45)}
.iss{position:fixed;inset:0;overflow:auto;background:var(--bg);color:var(--ink);font:14px/1.4 "Segoe UI",Calibri,Arial,sans-serif}
.iss *{box-sizing:border-box}
.iss .app{display:grid;grid-template-columns:252px minmax(0,1fr);min-height:100vh}
.iss .main{min-width:0;padding:0 28px 40px}.iss .main-in{max-width:1180px;margin:0 auto}
.iss .side{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--side-bg);color:var(--side-ink);display:flex;flex-direction:column;gap:8px;padding:18px 12px 14px}
.iss .brand{display:flex;align-items:center;gap:10px;padding:2px 8px 14px;border-bottom:1px solid var(--side-line)}
.iss .logo{width:34px;height:34px;border-radius:9px;background:var(--brand-soft);color:var(--brand-soft-ink);display:grid;place-items:center;font-weight:800;font-size:13px;flex:none}
.iss .brand b{display:block;font-size:15px;line-height:1.2}.iss .brand small{color:var(--side-ink2);font-size:11.5px}
.iss .side-close{display:none;margin-left:auto;background:transparent;border:1px solid var(--side-line);color:var(--side-ink);border-radius:8px;width:30px;height:30px;cursor:pointer}
.iss .nav-lbl{font-size:10.5px;letter-spacing:.7px;text-transform:uppercase;color:var(--side-ink2);font-weight:700;padding:4px 10px 0}
.iss #nav{display:flex;flex-direction:column;gap:2px;flex:1}
.iss .grp-btn{display:flex;align-items:center;gap:10px;width:100%;background:transparent;border:0;color:var(--side-ink2);padding:9px 10px;border-radius:8px;font-weight:600;font-size:13.5px;text-align:left;cursor:pointer}
.iss .grp-btn:hover{background:var(--side-hover);color:var(--side-ink)}.iss .grp-btn.cur{background:var(--side-act);color:var(--side-ink)}
.iss .side-foot{border-top:1px solid var(--side-line);padding:12px 8px 0;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10.5px;color:var(--side-ink2)}
.iss .side-foot button{background:transparent;color:var(--side-ink);border:1px solid var(--side-line);border-radius:7px;padding:5px 9px;font-size:12px;cursor:pointer}
.iss .scrim{position:fixed;inset:0;background:var(--scrim);z-index:55}
.iss .topbar{position:sticky;top:0;z-index:30;background:var(--bg);border-bottom:1px solid var(--line);margin-bottom:18px}
.iss .topbar-in{max-width:1180px;margin:0 auto;display:flex;align-items:center;gap:10px;min-height:64px}
.iss .menu-btn{display:none;background:var(--card);border:1px solid var(--line);border-radius:7px;padding:6px 10px;font-weight:600;cursor:pointer}
.iss .crumbs{display:flex;flex-wrap:wrap;gap:6px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:700}
.iss .tb-right{margin-left:auto;display:flex;align-items:center;gap:8px}
.iss .conn{display:flex;align-items:center;gap:9px;padding:5px 12px 5px 10px;border-radius:999px}
.iss .conn b{display:block;font-size:12.5px}.iss .conn small{display:block;font-size:11px;color:var(--ink2)}
.iss .sdot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--good);box-shadow:0 0 0 3px var(--good-bg)}
.iss .sdot[data-st="off"]{background:var(--neutral);box-shadow:0 0 0 3px var(--neutral-bg)}
.iss .page-head{margin-bottom:14px}.iss h1{margin:0 0 2px;font-size:24px;letter-spacing:-.2px}
.iss .sub-desc{color:var(--ink2);font-size:13px;margin:0;max-width:80ch}
.iss .view{display:grid;gap:16px}.iss .grid{display:grid;gap:16px}
.iss .card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:16px 18px;min-width:0}
.iss .card h2{font-size:15px;margin:0 0 2px}.iss .hint{font-size:12px;color:var(--muted);margin-bottom:8px}
.iss .card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.iss .warn-note{border-color:var(--warn);background:var(--warn-bg)}.iss .crit-note{border-color:var(--crit);background:var(--crit-bg)}
.iss .steps{margin:8px 0 0;padding-left:20px}.iss .steps li{margin:4px 0;font-size:13px}
.iss code{background:var(--grid);padding:1px 5px;border-radius:5px;font-size:12px}
.iss .btn-cta{background:var(--exe);color:#fff;border:0;border-radius:8px;padding:9px 14px;font-weight:600;font-size:13px;cursor:pointer}
.iss .btn-cta:disabled{opacity:.6;cursor:default}
.iss .kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
.iss .kpi{display:flex;flex-direction:column}.iss .kpi .lbl{font-size:13px;color:var(--ink2);font-weight:600;display:flex;align-items:center;gap:8px}
.iss .kpi .dot{width:10px;height:10px;border-radius:3px;display:inline-block}
.iss .kpi .val{font-size:32px;font-weight:700;line-height:1.05;margin:6px 0 4px;font-variant-numeric:tabular-nums}
.iss .kpi .foot{font-size:12.5px;color:var(--ink2)}
.iss .filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 10px;box-shadow:var(--shadow)}
.iss input[type=search]{font:inherit;font-size:13px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:7px;padding:6px 8px;min-width:220px}
.iss .count{font-size:12.5px;color:var(--ink2);margin-left:auto}.iss .count b{color:var(--ink)}
.iss .tbl-wrap{max-height:560px;overflow:auto;border:1px solid var(--line);border-radius:8px}.iss .tbl-wrap.tall{max-height:min(700px,78vh)}
.iss table{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}
.iss thead th{position:sticky;top:0;z-index:2;background:var(--head);color:var(--head-ink);font-weight:600;text-align:left;padding:8px 10px;font-size:12px;white-space:nowrap}
.iss tbody td{padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}.iss tbody tr:hover td{background:var(--hover)}
.iss td.cd{color:var(--muted);font-size:12px}.iss td.wrapc{white-space:normal;min-width:240px;font-size:12.5px}
.iss .num{text-align:right;font-variant-numeric:tabular-nums}
.iss .chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px}
.iss .chip .ic{width:14px;height:14px;border-radius:50%;display:inline-grid;place-items:center;font-size:9px;color:#fff;font-weight:700}
.iss .st-good{background:var(--good-bg)}.iss .st-good .ic{background:var(--good)}
.iss .st-warn{background:var(--warn-bg)}.iss .st-warn .ic{background:var(--warn);color:#3a2a00}
.iss .st-crit{background:var(--crit-bg)}.iss .st-crit .ic{background:var(--crit)}
.iss .hbars{display:flex;flex-direction:column;gap:7px}
.iss .hbar{display:grid;grid-template-columns:220px minmax(0,1fr) 120px;align-items:center;gap:10px}
.iss .hlbl{font-size:12.5px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iss .htrack{background:var(--grid);border-radius:5px;height:12px;overflow:hidden}.iss .htrack i{display:block;height:100%;border-radius:5px}
.iss .hval{font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums;color:var(--ink)}
@media(max-width:900px){.iss .app{grid-template-columns:1fr}.iss .side{position:fixed;left:0;top:0;z-index:60;width:252px;transform:translateX(-100%);transition:transform .2s}.iss .side.open{transform:none}.iss .side-close{display:grid;place-items:center}.iss .menu-btn{display:inline-flex;align-items:center;gap:6px}.iss .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.iss .hbar{grid-template-columns:140px minmax(0,1fr) 100px}}
`;
