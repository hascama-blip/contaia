"use client";

import { useEffect, useState } from "react";

// Dashboard ISSOSOMA — look basado en "Dashboard de Operaciones" (navarro):
// menú lateral verde, KPIs de número grande, tablas con cabecera verde. Lee el
// análisis de /api/issosoma (carpeta Drive por cuenta de servicio).

type Analisis = {
  configurado: boolean;
  faltan?: string[];
  cuentaServicio?: string;
  folderId?: string;
  archivos: { name: string; mimeType: string; modifiedTime?: string; filas?: number; leido: boolean; nota?: string }[];
  kpis: { ingresos: number; egresos: number; utilidad: number; margen: number; viaticos: number; movimientos: number };
  porMes: { mes: string; ingresos: number; egresos: number; utilidad: number }[];
  porCategoria: { categoria: string; egresos: number; ingresos: number }[];
  porSede: { sede: string; ingresos: number; egresos: number; utilidad: number }[];
  porPersona: { persona: string; viaticos: number; movimientos: number }[];
  viaticos: { fecha: string; persona: string; concepto: string; categoria: string; sede: string; estado: string; egreso: number }[];
  error?: string;
  generadoAt: string;
};

const VISTAS = [
  { id: "resumen", label: "Resumen" },
  { id: "movimientos", label: "Ingresos y egresos" },
  { id: "viaticos", label: "Rendición de viáticos" },
  { id: "sedes", label: "Por sede / proyecto" },
  { id: "personas", label: "Por persona" },
  { id: "conexion", label: "Conexión de datos" },
] as const;
type VistaId = (typeof VISTAS)[number]["id"];

const S = (n: number) =>
  "S/ " + (n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT = (n: number) => (n * 100).toFixed(1) + "%";

export default function IssosomaDashboard() {
  const [data, setData] = useState<Analisis | null>(null);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState<VistaId>("resumen");
  const [menu, setMenu] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const res = await fetch("/api/issosoma", { cache: "no-store" });
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { cargar(); }, []);

  const k = data?.kpis;
  const vistaActual = VISTAS.find((v) => v.id === vista)!;

  return (
    <div className="iss">
      <style>{CSS}</style>
      <div className="app">
        {/* Menú lateral */}
        <aside className={`side ${menu ? "open" : ""}`}>
          <div className="brand">
            <div className="logo">IS</div>
            <div><b>ISSOSOMA</b><small>Viáticos · Ingresos · Egresos</small></div>
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
            <span>{data?.generadoAt ? new Date(data.generadoAt).toLocaleString("es-PE") : ""}</span>
            <button onClick={cargar}>Actualizar</button>
          </div>
        </aside>
        {menu && <div className="scrim" onClick={() => setMenu(false)} />}

        {/* Contenido */}
        <main className="main">
          <div className="topbar"><div className="topbar-in">
            <button className="menu-btn" onClick={() => setMenu(true)}>☰ Menú</button>
            <div className="crumbs"><span>ISSOSOMA</span> · <span>{vistaActual.label}</span></div>
            <div className="tb-right">
              <span className="conn">
                <span className="sdot" data-st={data?.configurado ? "" : "off"} />
                <span><b>{data?.configurado ? "Conectado a Drive" : "Sin conectar"}</b>
                  <small>{data?.cuentaServicio || (cargando ? "cargando…" : "configura el acceso")}</small></span>
              </span>
            </div>
          </div></div>

          <div className="main-in">
            {cargando && <div className="card">Cargando datos de ISSOSOMA…</div>}

            {!cargando && data && !data.configurado && <Conexion data={data} />}

            {!cargando && data && data.configurado && (
              <>
                {data.error && <div className="card crit-note">⚠ {data.error}</div>}

                {vista === "resumen" && k && (
                  <div className="view">
                    <div className="page-head"><h1>Resumen financiero</h1>
                      <p className="sub-desc">Ingresos, egresos y utilidad consolidados de la carpeta de ISSOSOMA · {k.movimientos} movimiento(s).</p></div>
                    <div className="grid kpis">
                      <Kpi lbl="Ingresos" dot="var(--good)" val={S(k.ingresos)} />
                      <Kpi lbl="Egresos" dot="var(--crit)" val={S(k.egresos)} />
                      <Kpi lbl="Utilidad" dot="var(--exe)" val={S(k.utilidad)} foot={`Margen ${PCT(k.margen)}`} />
                      <Kpi lbl="Viáticos" dot="var(--warn)" val={S(k.viaticos)} foot={`${data.viaticos.length} rendición(es)`} />
                    </div>
                    <div className="card">
                      <div className="card-head"><div><h2>Ingresos vs egresos por mes</h2><div className="hint">Barras por periodo (verde = ingresos, rojo = egresos).</div></div></div>
                      <BarrasMes filas={data.porMes} />
                    </div>
                    <div className="card">
                      <div className="card-head"><div><h2>Egresos por categoría</h2></div></div>
                      <BarrasH filas={data.porCategoria.map((c) => ({ label: c.categoria, val: c.egresos }))} color="var(--crit)" />
                    </div>
                  </div>
                )}

                {vista === "movimientos" && (
                  <div className="view">
                    <div className="page-head"><h1>Ingresos y egresos</h1><p className="sub-desc">Detalle por mes y por categoría.</p></div>
                    <div className="card"><h2>Por mes</h2>
                      <div className="tbl-wrap flat"><table>
                        <thead><tr><th>Mes</th><th className="num">Ingresos</th><th className="num">Egresos</th><th className="num">Utilidad</th></tr></thead>
                        <tbody>{data.porMes.map((m) => (
                          <tr key={m.mes}><td>{m.mes}</td><td className="num">{S(m.ingresos)}</td><td className="num">{S(m.egresos)}</td><td className="num">{S(m.utilidad)}</td></tr>
                        ))}{!data.porMes.length && <tr><td colSpan={4}>Sin datos de fecha para agrupar por mes.</td></tr>}</tbody>
                      </table></div>
                    </div>
                    <div className="card"><h2>Por categoría</h2>
                      <div className="tbl-wrap"><table>
                        <thead><tr><th>Categoría</th><th className="num">Egresos</th><th className="num">Ingresos</th></tr></thead>
                        <tbody>{data.porCategoria.map((c) => (
                          <tr key={c.categoria}><td>{c.categoria}</td><td className="num">{S(c.egresos)}</td><td className="num">{S(c.ingresos)}</td></tr>
                        ))}</tbody>
                      </table></div>
                    </div>
                  </div>
                )}

                {vista === "viaticos" && (
                  <div className="view">
                    <div className="page-head"><h1>Rendición de viáticos</h1><p className="sub-desc">{data.viaticos.length} movimiento(s) de viáticos · total {S(k!.viaticos)}.</p></div>
                    <div className="card">
                      <div className="tbl-wrap tall"><table>
                        <thead><tr><th>Fecha</th><th>Persona</th><th>Concepto</th><th>Sede</th><th>Estado</th><th className="num">Monto</th></tr></thead>
                        <tbody>{data.viaticos.map((v, i) => (
                          <tr key={i}><td className="cd">{v.fecha}</td><td>{v.persona || "—"}</td><td className="wrapc">{v.concepto || "—"}</td><td>{v.sede || "—"}</td><td>{v.estado || "—"}</td><td className="num">{S(v.egreso)}</td></tr>
                        ))}{!data.viaticos.length && <tr><td colSpan={6}>No se detectaron viáticos (revisa Conexión de datos para calibrar columnas).</td></tr>}</tbody>
                      </table></div>
                    </div>
                  </div>
                )}

                {vista === "sedes" && (
                  <div className="view">
                    <div className="page-head"><h1>Por sede / proyecto</h1></div>
                    <div className="card"><div className="tbl-wrap"><table>
                      <thead><tr><th>Sede / proyecto</th><th className="num">Ingresos</th><th className="num">Egresos</th><th className="num">Utilidad</th></tr></thead>
                      <tbody>{data.porSede.map((s) => (
                        <tr key={s.sede}><td>{s.sede}</td><td className="num">{S(s.ingresos)}</td><td className="num">{S(s.egresos)}</td><td className="num">{S(s.utilidad)}</td></tr>
                      ))}{!data.porSede.length && <tr><td colSpan={4}>Sin columna de sede/proyecto detectada.</td></tr>}</tbody>
                    </table></div></div>
                  </div>
                )}

                {vista === "personas" && (
                  <div className="view">
                    <div className="page-head"><h1>Viáticos por persona</h1></div>
                    <div className="card"><BarrasH filas={data.porPersona.map((p) => ({ label: p.persona, val: p.viaticos }))} color="var(--warn)" />
                      <div className="tbl-wrap flat"><table>
                        <thead><tr><th>Persona</th><th className="num">Viáticos</th><th className="num">Movs.</th></tr></thead>
                        <tbody>{data.porPersona.map((p) => (
                          <tr key={p.persona}><td>{p.persona}</td><td className="num">{S(p.viaticos)}</td><td className="num">{p.movimientos}</td></tr>
                        ))}{!data.porPersona.length && <tr><td colSpan={3}>Sin columna de persona/responsable detectada.</td></tr>}</tbody>
                      </table></div>
                    </div>
                  </div>
                )}

                {vista === "conexion" && <Conexion data={data} />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Kpi({ lbl, dot, val, foot }: { lbl: string; dot: string; val: string; foot?: string }) {
  return (
    <div className="card kpi">
      <div className="lbl"><span className="dot" style={{ background: dot }} />{lbl}</div>
      <div className="val">{val}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

function BarrasMes({ filas }: { filas: { mes: string; ingresos: number; egresos: number }[] }) {
  if (!filas.length) return <div className="hint">Sin datos de fecha para graficar por mes.</div>;
  const max = Math.max(1, ...filas.map((f) => Math.max(f.ingresos, f.egresos)));
  const W = Math.max(520, filas.length * 70), H = 220, pad = 28, bw = 18;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  return (
    <div className="cs-chart"><svg viewBox={`0 0 ${W} ${H}`} className="spark">
      {filas.map((f, i) => {
        const cx = pad + i * ((W - pad * 2) / filas.length) + 18;
        return (
          <g key={f.mes}>
            <rect x={cx - bw - 2} y={y(f.ingresos)} width={bw} height={H - pad - y(f.ingresos)} fill="var(--good)" rx="2" />
            <rect x={cx + 2} y={y(f.egresos)} width={bw} height={H - pad - y(f.egresos)} fill="var(--crit)" rx="2" />
            <text x={cx} y={H - 8} fontSize="10" textAnchor="middle" fill="var(--muted)">{f.mes.slice(2)}</text>
          </g>
        );
      })}
    </svg></div>
  );
}

function BarrasH({ filas, color }: { filas: { label: string; val: number }[]; color: string }) {
  const top = filas.filter((f) => f.label).slice(0, 12);
  if (!top.length) return <div className="hint">Sin datos.</div>;
  const max = Math.max(1, ...top.map((f) => f.val));
  return (
    <div className="hbars">{top.map((f) => (
      <div className="hbar" key={f.label}>
        <span className="hlbl" title={f.label}>{f.label}</span>
        <span className="htrack"><i style={{ width: `${(f.val / max) * 100}%`, background: color }} /></span>
        <span className="hval">{S(f.val)}</span>
      </div>
    ))}</div>
  );
}

function Conexion({ data }: { data: Analisis }) {
  return (
    <div className="view">
      <div className="page-head"><h1>Conexión de datos</h1>
        <p className="sub-desc">ISSOSOMA lee una carpeta de Google Drive por <b>cuenta de servicio</b> (solo lectura).</p></div>
      {!data.configurado && (
        <div className="card warn-note">
          <h2>Falta configurar el acceso</h2>
          <p className="hint">Para activar el dashboard, un administrador debe configurar en el servidor (Render/Railway → Environment):</p>
          <ol className="steps">
            <li><b>GOOGLE_SERVICE_ACCOUNT_JSON</b> — el JSON de una cuenta de servicio de Google Cloud (con la API de Drive habilitada).</li>
            <li><b>ISSOSOMA_DRIVE_FOLDER_ID</b> — el ID de la carpeta de Drive (lo que va después de <code>/folders/</code> en la URL).</li>
            <li>Compartir esa carpeta de Drive (como <b>Lector</b>) con el email <code>client_email</code> de la cuenta de servicio.</li>
          </ol>
          {data.faltan?.length ? <p className="hint">Pendiente: <b>{data.faltan.join(", ")}</b>.</p> : null}
        </div>
      )}
      <div className="card">
        <div className="card-head"><div><h2>Archivos en la carpeta</h2>
          <div className="hint">{data.cuentaServicio ? `Cuenta de servicio: ${data.cuentaServicio}` : ""}{data.folderId ? ` · Carpeta: ${data.folderId}` : ""}</div></div></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Archivo</th><th>Tipo</th><th className="num">Filas</th><th>Estado</th></tr></thead>
          <tbody>{data.archivos.map((a, i) => (
            <tr key={i}><td>{a.name}</td><td className="cd">{a.mimeType.split(".").pop()}</td><td className="num">{a.filas ?? "—"}</td>
              <td>{a.leido ? <span className="chip st-good"><span className="ic">✓</span>leído</span> : <span className="chip st-neutral"><span className="ic">·</span>{a.nota || "no leído"}</span>}</td></tr>
          ))}{!data.archivos.length && <tr><td colSpan={4}>La carpeta está vacía o aún no es accesible.</td></tr>}</tbody>
        </table></div>
      </div>
    </div>
  );
}

const CSS = `
.iss{--bg:#dcd8ce;--card:#fff;--ink:#22302a;--ink2:#4f5c55;--muted:#7a847d;--line:#d2cdc2;--grid:#ebe7de;--hover:#f4f2ec;--head:#2f4a3b;--head-ink:#fff;--exe:#2f5a43;--good:#4e8a3e;--warn:#d1a12a;--crit:#b5483b;--neutral:#a8a397;--good-bg:#e2eedb;--warn-bg:#f8eed2;--crit-bg:#f5dfda;--neutral-bg:#ece9e2;--exe-soft:#d3dfcc;--shadow:0 1px 2px rgba(34,48,42,.07),0 2px 8px rgba(34,48,42,.06);--side-bg:#26402f;--side-ink:#fff;--side-ink2:#c3cfbf;--side-line:rgba(255,255,255,.13);--side-hover:rgba(255,255,255,.08);--side-act:rgba(255,255,255,.17);--brand-soft:#cfdac4;--brand-soft-ink:#22302a;--scrim:rgba(20,30,24,.45)}
.iss{position:fixed;inset:0;overflow:auto;background:var(--bg);color:var(--ink);font:14px/1.4 "Segoe UI",Calibri,Arial,sans-serif}
.iss *{box-sizing:border-box}
.iss .app{display:grid;grid-template-columns:252px minmax(0,1fr);min-height:100vh}
.iss .main{min-width:0;padding:0 28px 40px}
.iss .main-in{max-width:1180px;margin:0 auto}
.iss .side{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--side-bg);color:var(--side-ink);display:flex;flex-direction:column;gap:8px;padding:18px 12px 14px}
.iss .brand{display:flex;align-items:center;gap:10px;padding:2px 8px 14px;border-bottom:1px solid var(--side-line)}
.iss .logo{width:34px;height:34px;border-radius:9px;background:var(--brand-soft);color:var(--brand-soft-ink);display:grid;place-items:center;font-weight:800;font-size:13px;flex:none}
.iss .brand b{display:block;font-size:15px;line-height:1.2}.iss .brand small{color:var(--side-ink2);font-size:11.5px}
.iss .side-close{display:none;margin-left:auto;background:transparent;border:1px solid var(--side-line);color:var(--side-ink);border-radius:8px;width:30px;height:30px;cursor:pointer}
.iss .nav-lbl{font-size:10.5px;letter-spacing:.7px;text-transform:uppercase;color:var(--side-ink2);font-weight:700;padding:4px 10px 0}
.iss #nav{display:flex;flex-direction:column;gap:2px;flex:1}
.iss .grp-btn{display:flex;align-items:center;gap:10px;width:100%;background:transparent;border:0;color:var(--side-ink2);padding:9px 10px;border-radius:8px;font-weight:600;font-size:13.5px;text-align:left;cursor:pointer}
.iss .grp-btn:hover{background:var(--side-hover);color:var(--side-ink)}
.iss .grp-btn.cur{background:var(--side-act);color:var(--side-ink)}
.iss .side-foot{border-top:1px solid var(--side-line);padding:12px 8px 0;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--side-ink2)}
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
.iss .kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
.iss .kpi{display:flex;flex-direction:column}
.iss .kpi .lbl{font-size:13px;color:var(--ink2);font-weight:600;display:flex;align-items:center;gap:8px}
.iss .kpi .dot{width:10px;height:10px;border-radius:3px;display:inline-block}
.iss .kpi .val{font-size:34px;font-weight:700;line-height:1.05;margin:6px 0 4px;font-variant-numeric:tabular-nums}
.iss .kpi .foot{font-size:12.5px;color:var(--ink2)}
.iss .tbl-wrap{max-height:540px;overflow:auto;border:1px solid var(--line);border-radius:8px}
.iss .tbl-wrap.tall{max-height:min(700px,78vh)}.iss .tbl-wrap.flat{max-height:none}
.iss table{border-collapse:separate;border-spacing:0;width:100%;font-size:13px}
.iss thead th{position:sticky;top:0;z-index:2;background:var(--head);color:var(--head-ink);font-weight:600;text-align:left;padding:8px 10px;font-size:12px;white-space:nowrap}
.iss tbody td{padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.iss tbody tr:hover td{background:var(--hover)}
.iss td.cd{color:var(--muted);font-size:12px}.iss td.wrapc{white-space:normal;min-width:240px}
.iss .num{text-align:right;font-variant-numeric:tabular-nums}
.iss .chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px}
.iss .chip .ic{width:14px;height:14px;border-radius:50%;display:inline-grid;place-items:center;font-size:9px;color:#fff;font-weight:700}
.iss .st-good{background:var(--good-bg)}.iss .st-good .ic{background:var(--good)}
.iss .st-neutral{background:var(--neutral-bg)}.iss .st-neutral .ic{background:var(--neutral)}
.iss .cs-chart{overflow-x:auto}.iss .spark{display:block;width:100%;min-width:520px;height:auto}
.iss .hbars{display:flex;flex-direction:column;gap:7px}
.iss .hbar{display:grid;grid-template-columns:160px minmax(0,1fr) 110px;align-items:center;gap:10px}
.iss .hlbl{font-size:12.5px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iss .htrack{background:var(--grid);border-radius:5px;height:12px;overflow:hidden}.iss .htrack i{display:block;height:100%;border-radius:5px}
.iss .hval{font-size:12.5px;text-align:right;font-variant-numeric:tabular-nums;color:var(--ink)}
@media(max-width:900px){.iss .app{grid-template-columns:1fr}.iss .side{position:fixed;left:0;top:0;z-index:60;width:252px;transform:translateX(-100%);transition:transform .2s}.iss .side.open{transform:none}.iss .side-close{display:grid;place-items:center}.iss .menu-btn{display:inline-flex;align-items:center;gap:6px}.iss .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.iss .hbar{grid-template-columns:110px minmax(0,1fr) 90px}}
`;
