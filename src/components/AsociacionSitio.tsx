"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Flyer { imagen: string; titulo: string; link: string }
interface Curso { id: string; imagen: string; titulo: string; descripcion: string; fecha: string; modalidad: string; precio: string; link: string; destacado?: boolean }
interface EventoCal { fecha: string; curso: string; modalidad: string }
interface Stat { icono: string; valor: string; label: string }
interface Testimonio { nombre: string; rol: string; texto: string }
interface Aliado { logo: string; nombre: string; link: string }
interface Contenido {
  marca: string; logo: string; lema: string;
  flyers: Flyer[];
  disponiblesTitulo: string; cursosDisponibles: Curso[];
  proximosTitulo: string; cursosProximos: Curso[];
  calendarioTitulo: string; calendario: EventoCal[];
  stats: Stat[];
  testimoniosTitulo: string; testimonios: Testimonio[];
  aliadosTitulo: string; aliados: Aliado[];
  contactoTitulo: string; contactoTexto: string; telefono: string; email: string; direccion: string; facebook: string;
}
type Agg = { sum: number; count: number };

const NAVY = "#0b2a63";
const GOLD = "#f4c20d";
const ED = "rounded border border-dashed border-current/40 bg-transparent px-1.5 py-0.5 outline-none focus:border-current focus:bg-black/5";
const uid = () => (crypto.randomUUID?.() || Math.random().toString(16).slice(2)).replace(/-/g, "").slice(0, 16);

export default function AsociacionSitio({ inicial, habilitada }: { inicial: Contenido; habilitada: boolean }) {
  const [c, setC] = useState<Contenido>(inicial);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [sugOpen, setSugOpen] = useState(false);
  const [verSug, setVerSug] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ratings, setRatings] = useState<Record<string, Agg>>({});

  useEffect(() => {
    fetch("/api/asociacion/session", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d?.editando) setEditando(true); }).catch(() => {});
    fetch("/api/asociacion/rating", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (d?.ratings) setRatings(d.ratings); }).catch(() => {});
  }, []);

  const set = (k: keyof Contenido, v: any) => setC((p) => ({ ...p, [k]: v }));

  const subir = useCallback(async (file: File): Promise<string | null> => {
    const fd = new FormData(); fd.append("archivo", file);
    const r = await fetch("/api/asociacion/media", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error || "No se pudo subir."); return null; }
    return d.url as string;
  }, []);

  async function guardar() {
    setGuardando(true); setMsg(null);
    try {
      const r = await fetch("/api/asociacion", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contenido: c }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || "No se pudo guardar."); return; }
      setMsg("Cambios guardados."); setTimeout(() => setMsg(null), 2500);
    } catch { setMsg("Error de red al guardar."); } finally { setGuardando(false); }
  }
  async function salirEdicion() {
    await fetch("/api/asociacion/login", { method: "DELETE" }).catch(() => {});
    window.location.reload();
  }
  async function votar(cursoId: string, valor: number) {
    try {
      const r = await fetch("/api/asociacion/rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cursoId, valor }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.agg) {
        setRatings((p) => ({ ...p, [cursoId]: d.agg }));
        try { localStorage.setItem(`asoc_voto_${cursoId}`, String(valor)); } catch {}
      }
    } catch {}
  }

  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* Top bar */}
      <div className="text-white" style={{ background: NAVY }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-1.5 text-xs">
          <span><Txt v={c.lema} editando={editando} onChange={(v) => set("lema", v)} as="span" /></span>
          <button onClick={() => setSugOpen(true)} className="hidden font-semibold sm:inline" style={{ color: GOLD }}>Sugerir curso</button>
        </div>
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <a href="#inicio" className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ImgEdit url={c.logo} editando={editando} onUpload={async (f) => { const u = await subir(f); if (u) set("logo", u); }}
              className="h-9 w-9 shrink-0 rounded-full object-contain sm:h-11 sm:w-11" fallback={<span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-black text-white sm:h-11 sm:w-11 sm:text-lg" style={{ background: NAVY }}>IM</span>} />
            <Txt v={c.marca} editando={editando} onChange={(v) => set("marca", v)} as="span" className="truncate text-[13px] font-extrabold leading-tight sm:max-w-none sm:whitespace-normal sm:text-base" style={{ color: NAVY }} />
          </a>
          {/* Menú desktop */}
          <nav className="hidden items-center gap-0.5 text-sm font-semibold text-slate-600 md:flex">
            <a href="#cursos" className="rounded-lg px-3 py-2 hover:bg-slate-100">Cursos</a>
            <a href="#proximos" className="rounded-lg px-3 py-2 hover:bg-slate-100">Próximos</a>
            <a href="#calendario" className="rounded-lg px-3 py-2 hover:bg-slate-100">Calendario</a>
            <a href="#contacto" className="rounded-lg px-3 py-2 hover:bg-slate-100">Contacto</a>
            <button onClick={() => setSugOpen(true)} className="ml-1 rounded-lg px-4 py-2 font-bold text-slate-900" style={{ background: GOLD }}>Sugerir curso</button>
          </nav>
          {/* Botón hamburguesa (móvil) */}
          <button onClick={() => setMenuOpen((o) => !o)} aria-label="Menú" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-2xl text-slate-700 hover:bg-slate-100 md:hidden">
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
        {/* Menú desplegable (móvil) */}
        {menuOpen && (
          <nav className="border-t border-slate-100 bg-white px-3 pb-3 pt-1 text-sm font-semibold text-slate-700 md:hidden">
            {[["#cursos", "Cursos"], ["#proximos", "Próximos"], ["#calendario", "Calendario"], ["#contacto", "Contacto"]].map(([h, t]) => (
              <a key={h} href={h} onClick={() => setMenuOpen(false)} className="block rounded-lg px-3 py-2.5 hover:bg-slate-100">{t}</a>
            ))}
            <button onClick={() => { setSugOpen(true); setMenuOpen(false); }} className="mt-1 block w-full rounded-lg px-4 py-2.5 text-left font-bold text-slate-900" style={{ background: GOLD }}>Sugerir curso</button>
          </nav>
        )}
      </header>

      {/* Carrusel de flyers */}
      <section id="inicio">
        <Carrusel c={c} setC={setC} editando={editando} subir={subir} />
      </section>

      {/* Estadísticas */}
      <section className="py-16 text-white" style={{ background: NAVY }}>
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 sm:grid-cols-4">
          {c.stats.map((st, i) => (
            <div key={i} className="relative rounded-2xl border border-white/10 bg-white/5 p-5 text-center">
              {editando && <button onClick={() => set("stats", c.stats.filter((_, j) => j !== i))} className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500/80 text-white">×</button>}
                <Txt v={st.valor} editando={editando} onChange={(v) => set("stats", c.stats.map((x, j) => j === i ? { ...x, valor: v } : x))} as="div" className="text-3xl font-extrabold" style={{ color: GOLD }} />
              <Txt v={st.label} editando={editando} onChange={(v) => set("stats", c.stats.map((x, j) => j === i ? { ...x, label: v } : x))} as="div" className="mt-1 text-xs uppercase tracking-wide text-white/70" />
            </div>
          ))}
          {editando && <button onClick={() => set("stats", [...c.stats, { icono: "", valor: "+100", label: "Nuevo dato" }])} className="grid min-h-[110px] place-items-center rounded-2xl border-2 border-dashed border-white/30 text-white/70">+ Dato</button>}
        </div>
      </section>

      {/* Cursos disponibles */}
      <section id="cursos" className="mx-auto max-w-6xl px-4 py-20">
        <Encabezado v={c.disponiblesTitulo} editando={editando} onChange={(v) => set("disponiblesTitulo", v)} sub="Inscríbete y certifícate con nosotros" />
        <Grid>
          {c.cursosDisponibles.map((curso, i) => (
            <CursoCard key={curso.id} curso={curso} editando={editando} subir={subir}
              agg={ratings[curso.id]} onVote={votar}
              onChange={(nv) => set("cursosDisponibles", c.cursosDisponibles.map((x, j) => j === i ? nv : x))}
              onRemove={() => set("cursosDisponibles", c.cursosDisponibles.filter((_, j) => j !== i))} />
          ))}
          {editando && <AddCard onClick={() => set("cursosDisponibles", [...c.cursosDisponibles, nuevoCurso()])} />}
        </Grid>
      </section>

      {/* Próximos cursos */}
      <section id="proximos" className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <Encabezado v={c.proximosTitulo} editando={editando} onChange={(v) => set("proximosTitulo", v)} sub="Prepárate para lo que viene" />
          <Grid>
            {c.cursosProximos.map((curso, i) => (
              <CursoCard key={curso.id} curso={curso} editando={editando} subir={subir} proximo
                onChange={(nv) => set("cursosProximos", c.cursosProximos.map((x, j) => j === i ? nv : x))}
                onRemove={() => set("cursosProximos", c.cursosProximos.filter((_, j) => j !== i))} />
            ))}
            {editando && <AddCard onClick={() => set("cursosProximos", [...c.cursosProximos, nuevoCurso()])} />}
          </Grid>
        </div>
      </section>

      {/* Calendario */}
      <section id="calendario" className="mx-auto max-w-4xl px-4 py-20">
        <Encabezado v={c.calendarioTitulo} editando={editando} onChange={(v) => set("calendarioTitulo", v)} sub="Fechas de inicio" />
        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-white" style={{ background: NAVY }}>
              <tr><th className="px-4 py-3 text-left">Fecha</th><th className="px-4 py-3 text-left">Curso</th><th className="px-4 py-3 text-left">Modalidad</th>{editando && <th className="w-10" />}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {c.calendario.map((ev, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-semibold" style={{ color: NAVY }}><Txt v={ev.fecha} editando={editando} onChange={(v) => set("calendario", c.calendario.map((x, j) => j === i ? { ...x, fecha: v } : x))} as="span" /></td>
                  <td className="px-4 py-2"><Txt v={ev.curso} editando={editando} onChange={(v) => set("calendario", c.calendario.map((x, j) => j === i ? { ...x, curso: v } : x))} as="span" /></td>
                  <td className="px-4 py-2"><Txt v={ev.modalidad} editando={editando} onChange={(v) => set("calendario", c.calendario.map((x, j) => j === i ? { ...x, modalidad: v } : x))} as="span" /></td>
                  {editando && <td className="px-2 text-center"><button onClick={() => set("calendario", c.calendario.filter((_, j) => j !== i))} className="text-red-500">×</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {editando && <button onClick={() => set("calendario", [...c.calendario, { fecha: "01/01/2026", curso: "Nuevo curso", modalidad: "Virtual" }])} className="w-full bg-slate-50 py-2 text-sm font-semibold" style={{ color: NAVY }}>+ Agregar fecha</button>}
        </div>
      </section>

      {/* Testimonios */}
      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <Encabezado v={c.testimoniosTitulo} editando={editando} onChange={(v) => set("testimoniosTitulo", v)} sub="La voz de quienes ya se capacitaron" />
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {c.testimonios.map((t, i) => (
              <div key={i} className="relative rounded-2xl bg-white p-6 ring-1 ring-slate-100">
                {editando && <button onClick={() => set("testimonios", c.testimonios.filter((_, j) => j !== i))} className="absolute right-2 top-2 text-red-500">×</button>}
                <div className="h-1 w-8 rounded-full" style={{ background: GOLD }} />
                <Txt v={t.texto} editando={editando} onChange={(v) => set("testimonios", c.testimonios.map((x, j) => j === i ? { ...x, texto: v } : x))} multiline className="mt-1 text-slate-600" />
                <div className="mt-3 flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-full font-bold text-white" style={{ background: NAVY }}>{(t.nombre || "?").slice(0, 1)}</span>
                  <div>
                    <Txt v={t.nombre} editando={editando} onChange={(v) => set("testimonios", c.testimonios.map((x, j) => j === i ? { ...x, nombre: v } : x))} as="div" className="text-sm font-bold text-slate-800" />
                    <Txt v={t.rol} editando={editando} onChange={(v) => set("testimonios", c.testimonios.map((x, j) => j === i ? { ...x, rol: v } : x))} as="div" className="text-xs text-slate-400" />
                  </div>
                </div>
              </div>
            ))}
            {editando && <AddCard alto onClick={() => set("testimonios", [...c.testimonios, { nombre: "Nombre", rol: "Profesión", texto: "Testimonio…" }])} label="+ Testimonio" />}
          </div>
        </div>
      </section>

      {/* Aliados */}
      {(c.aliados.length > 0 || editando) && (
        <section id="aliados" className="mx-auto max-w-6xl px-4 py-20">
          <Encabezado v={c.aliadosTitulo} editando={editando} onChange={(v) => set("aliadosTitulo", v)} sub="Instituciones y empresas que confían en nosotros" />
          <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {c.aliados.map((al, i) => {
              const up = (k: keyof Aliado, v: string) => set("aliados", c.aliados.map((x, j) => j === i ? { ...x, [k]: v } : x));
              const card = (
                <div className="flex h-24 items-center justify-center rounded-xl border border-slate-200 bg-white p-4 transition">
                  {al.logo ? <img src={al.logo} alt={al.nombre} className="max-h-16 max-w-full object-contain" /> : <span className="text-xs text-slate-400">Logo</span>}
                </div>
              );
              return (
                <div key={i} className="group relative">
                  {editando && <button onClick={() => set("aliados", c.aliados.filter((_, j) => j !== i))} className="absolute -right-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-full bg-red-600 text-white shadow">×</button>}
                  {!editando && al.link
                    ? <a href={al.link} target="_blank" rel="noreferrer" title={al.nombre}>{card}</a>
                    : card}
                  {editando && (
                    <div className="mt-1 space-y-1">
                      <label className="block cursor-pointer rounded bg-slate-100 py-1 text-center text-[11px] font-semibold text-slate-600 hover:bg-slate-200">Subir logo
                        <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const u = await subir(f); if (u) up("logo", u); } e.currentTarget.value = ""; }} />
                      </label>
                      <input value={al.nombre} onChange={(e) => up("nombre", e.target.value)} placeholder="Nombre" className="block w-full rounded border border-slate-200 px-1.5 py-0.5 text-[11px]" />
                      <input value={al.link} onChange={(e) => up("link", e.target.value)} placeholder="https://web…" className="block w-full rounded border border-slate-200 px-1.5 py-0.5 text-[11px]" />
                    </div>
                  )}
                </div>
              );
            })}
            {editando && (
              <button onClick={() => set("aliados", [...c.aliados, { logo: "", nombre: "", link: "" }])} className="grid h-24 place-items-center rounded-xl border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-500 hover:bg-slate-50">+ Aliado</button>
            )}
          </div>
        </section>
      )}

      {/* Contacto */}
      <section id="contacto" className="mx-auto max-w-4xl px-4 py-20 text-center">
        <Encabezado v={c.contactoTitulo} editando={editando} onChange={(v) => set("contactoTitulo", v)} />
        <Txt v={c.contactoTexto} editando={editando} onChange={(v) => set("contactoTexto", v)} multiline className="mx-auto mt-3 max-w-2xl text-lg text-slate-600" />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Contacto label="Teléfono" v={c.telefono} editando={editando} onChange={(v) => set("telefono", v)} href={`tel:${c.telefono}`} />
          <Contacto label="Correo" v={c.email} editando={editando} onChange={(v) => set("email", v)} href={`mailto:${c.email}`} />
          <Contacto label="Dirección" v={c.direccion} editando={editando} onChange={(v) => set("direccion", v)} />
        </div>
        <button onClick={() => setSugOpen(true)} className="mt-8 rounded-full px-7 py-3 font-bold text-slate-900" style={{ background: GOLD }}>Sugiere un curso que te gustaría</button>
      </section>

      <footer className="py-8 text-center text-sm text-white/80" style={{ background: NAVY }}>
        © {new Date().getFullYear()} {c.marca}. Todos los derechos reservados.
      </footer>

      {/* Barra de edición */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-wrap items-center justify-end gap-2">
        {msg && <span className="rounded-full bg-slate-900/90 px-3 py-2 text-xs text-white shadow-lg">{msg}</span>}
        {editando ? (
          <>
            <button onClick={() => setVerSug(true)} className="rounded-full bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-lg ring-1 ring-slate-200 hover:bg-slate-50">Sugerencias</button>
            <button onClick={guardar} disabled={guardando} className="rounded-full px-5 py-3 text-sm font-bold text-slate-900 shadow-lg disabled:opacity-60" style={{ background: GOLD }}>{guardando ? "Guardando…" : "Guardar"}</button>
            <button onClick={() => window.location.reload()} className="rounded-full bg-white px-4 py-3 text-sm text-slate-600 shadow-lg ring-1 ring-slate-200">Deshacer</button>
            <button onClick={salirEdicion} className="rounded-full bg-white px-4 py-3 text-sm text-slate-600 shadow-lg ring-1 ring-slate-200">Salir</button>
          </>
        ) : habilitada ? (
          <button onClick={() => setLoginOpen(true)} className="rounded-full bg-slate-900/80 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-slate-900">Editar</button>
        ) : null}
      </div>

      {loginOpen && !editando && <LoginModal onClose={() => setLoginOpen(false)} onOk={() => { setLoginOpen(false); setEditando(true); }} />}
      {sugOpen && <SugerirModal onClose={() => setSugOpen(false)} />}
      {verSug && <SugerenciasModal onClose={() => setVerSug(false)} />}
    </div>
  );
}

function nuevoCurso(): Curso { return { id: uid(), imagen: "", titulo: "Nuevo curso", descripcion: "Descripción del curso.", fecha: "Inscripciones abiertas", modalidad: "Virtual", precio: "S/ 0", link: "" }; }

// ---- Carrusel --------------------------------------------------------------
function Carrusel({ c, setC, editando, subir }: { c: Contenido; setC: any; editando: boolean; subir: (f: File) => Promise<string | null> }) {
  const flyers = c.flyers;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (editando || flyers.length <= 1) return;
    const t = setInterval(() => setI((x) => (x + 1) % flyers.length), 5000);
    return () => clearInterval(t);
  }, [editando, flyers.length]);
  const idx = flyers.length ? ((i % flyers.length) + flyers.length) % flyers.length : 0;
  const cur = flyers[idx];
  const setFlyers = (f: Flyer[]) => setC((p: Contenido) => ({ ...p, flyers: f }));

  return (
    <div className="relative w-full overflow-hidden bg-slate-100">
      <div className="relative mx-auto h-56 max-w-6xl sm:h-72 md:h-96">
        {cur?.imagen ? (
          cur.link && !editando
            ? <a href={cur.link} target="_blank" rel="noreferrer"><img src={cur.imagen} alt={cur.titulo} className="h-full w-full object-cover" /></a>
            : <img src={cur.imagen} alt={cur.titulo} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center px-4 text-center text-white sm:px-6" style={{ background: `linear-gradient(135deg, ${NAVY}, #133a86)` }}>
            <h1 className="text-2xl font-extrabold leading-tight sm:text-4xl">{c.marca}</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/85 sm:text-base">{c.lema}</p>
          </div>
        )}
        {/* Flechas */}
        {flyers.length > 1 && (
          <>
            <button onClick={() => setI(idx - 1)} className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-slate-700 shadow hover:bg-white">‹</button>
            <button onClick={() => setI(idx + 1)} className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-slate-700 shadow hover:bg-white">›</button>
          </>
        )}
        {/* Dots */}
        {flyers.length > 1 && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
            {flyers.map((_, k) => <button key={k} onClick={() => setI(k)} className="h-2.5 w-2.5 rounded-full" style={{ background: k === idx ? GOLD : "rgba(255,255,255,.6)" }} />)}
          </div>
        )}
        {/* Controles de edición */}
        {editando && (
          <div className="absolute right-3 top-3 flex flex-col gap-2">
            <label className="cursor-pointer rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow">{cur?.imagen ? "Reemplazar" : "Subir flyer"}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const u = await subir(f); if (u) { if (flyers.length === 0) setFlyers([{ imagen: u, titulo: "", link: "" }]); else setFlyers(flyers.map((x, k) => k === idx ? { ...x, imagen: u } : x)); } e.currentTarget.value = ""; }} />
            </label>
            <label className="cursor-pointer rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow">Agregar flyer
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const u = await subir(f); if (u) { setFlyers([...flyers, { imagen: u, titulo: "", link: "" }]); setI(flyers.length); } e.currentTarget.value = ""; }} />
            </label>
            {cur && <button onClick={() => { setFlyers(flyers.filter((_, k) => k !== idx)); setI(0); }} className="rounded-full bg-red-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow">Quitar</button>}
          </div>
        )}
        {editando && cur && (
          <div className="absolute bottom-3 left-3 right-24 rounded-lg bg-black/50 p-2 text-white">
            <input value={cur.link} onChange={(e) => setFlyers(flyers.map((x, k) => k === idx ? { ...x, link: e.target.value } : x))} placeholder="Enlace del flyer (opcional): https://…" className="w-full rounded bg-white/10 px-2 py-1 text-xs outline-none placeholder:text-white/50" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Tarjeta de curso ------------------------------------------------------
function CursoCard({ curso, editando, subir, agg, onVote, onChange, onRemove, proximo }: {
  curso: Curso; editando: boolean; subir: (f: File) => Promise<string | null>; agg?: Agg; onVote?: (id: string, v: number) => void;
  onChange: (c: Curso) => void; onRemove: () => void; proximo?: boolean;
}) {
  const up = (k: keyof Curso, v: any) => onChange({ ...curso, [k]: v });
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-100 transition">
      {editando && <button onClick={onRemove} className="absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-red-600/90 text-white">×</button>}
      <div className="relative aspect-[16/10] bg-slate-100">
        {curso.imagen ? <img src={curso.imagen} alt={curso.titulo} className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-slate-300">Flyer del curso</div>}
        {editando && (
          <label className="absolute inset-0 grid cursor-pointer place-items-center bg-black/40 text-sm font-medium text-white opacity-0 transition group-hover:opacity-100">Cambiar flyer
            <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const u = await subir(f); if (u) up("imagen", u); } e.currentTarget.value = ""; }} />
          </label>
        )}
        <span className="absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-bold text-slate-900" style={{ background: GOLD }}>
          {editando ? <input value={curso.modalidad} onChange={(e) => up("modalidad", e.target.value)} className="w-20 bg-transparent outline-none" /> : curso.modalidad}
        </span>
        {proximo && <span className="absolute bottom-2 right-2 rounded-full bg-slate-900/80 px-2.5 py-0.5 text-xs font-semibold text-white">Próximamente</span>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <Txt v={curso.titulo} editando={editando} onChange={(v) => up("titulo", v)} as="h3" className="text-base font-bold" style={{ color: NAVY }} />
        <Txt v={curso.descripcion} editando={editando} onChange={(v) => up("descripcion", v)} multiline className="mt-1 flex-1 text-sm text-slate-500" />
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-500">{editando ? <input value={curso.fecha} onChange={(e) => up("fecha", e.target.value)} className={`w-28 ${ED}`} /> : curso.fecha}</span>
          <span className="font-extrabold" style={{ color: NAVY }}>{editando ? <input value={curso.precio} onChange={(e) => up("precio", e.target.value)} className={`w-20 text-right ${ED}`} /> : curso.precio}</span>
        </div>
        {!proximo && <Estrellas cursoId={curso.id} agg={agg} editando={editando} onVote={onVote} />}
        <div className="mt-3">
          {editando
            ? <input value={curso.link} onChange={(e) => up("link", e.target.value)} placeholder="Enlace de inscripción" className={`w-full text-xs ${ED}`} />
            : <a href={curso.link || "#contacto"} target={curso.link ? "_blank" : undefined} rel="noreferrer" className="block rounded-xl py-2.5 text-center text-sm font-bold text-white" style={{ background: NAVY }}>{proximo ? "Más información" : "Inscribirme"}</a>}
        </div>
      </div>
    </div>
  );
}

function Estrellas({ cursoId, agg, editando, onVote }: { cursoId: string; agg?: Agg; editando: boolean; onVote?: (id: string, v: number) => void }) {
  const [hover, setHover] = useState(0);
  const [miVoto, setMiVoto] = useState(0);
  useEffect(() => { try { setMiVoto(Number(localStorage.getItem(`asoc_voto_${cursoId}`)) || 0); } catch {} }, [cursoId]);
  const prom = agg && agg.count ? agg.sum / agg.count : 0;
  const marca = hover || miVoto || Math.round(prom);
  const puedeVotar = !editando && !miVoto;
  return (
    <div className="mt-3 flex items-center gap-2">
      <div className="flex" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" disabled={!puedeVotar}
            onMouseEnter={() => puedeVotar && setHover(n)}
            onClick={() => { if (puedeVotar && onVote) { onVote(cursoId, n); setMiVoto(n); } }}
            className={`text-lg leading-none ${puedeVotar ? "cursor-pointer" : "cursor-default"}`}
            style={{ color: n <= marca ? GOLD : "#d1d5db" }} title={puedeVotar ? `Calificar con ${n}` : ""}>★</button>
        ))}
      </div>
      <span className="text-xs text-slate-500">
        {agg && agg.count ? `${prom.toFixed(1)} (${agg.count})` : "Sé el primero en calificar"}
        {miVoto ? " · ¡Gracias!" : ""}
      </span>
    </div>
  );
}

// ---- UI helpers ------------------------------------------------------------
function Encabezado({ v, editando, onChange, sub }: { v: string; editando: boolean; onChange: (s: string) => void; sub?: string }) {
  return (
    <div className="text-center">
      <Txt v={v} editando={editando} onChange={onChange} as="h2" className="text-2xl font-semibold tracking-tight sm:text-[28px]" style={{ color: NAVY }} />
      {sub && <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-400">{sub}</p>}
    </div>
  );
}
function Grid({ children }: { children: React.ReactNode }) { return <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{children}</div>; }
function AddCard({ onClick, label = "+ Agregar curso", alto }: { onClick: () => void; label?: string; alto?: boolean }) {
  return <button onClick={onClick} className={`grid ${alto ? "min-h-[160px]" : "min-h-[260px]"} place-items-center rounded-2xl border-2 border-dashed border-slate-300 font-semibold text-slate-500 hover:bg-slate-50`}>{label}</button>;
}
function Txt({ v, onChange, editando, as = "p", className = "", style, multiline, rows = 3 }: {
  v: string; onChange?: (s: string) => void; editando: boolean; as?: any; className?: string; style?: React.CSSProperties; multiline?: boolean; rows?: number;
}) {
  if (!editando) { const Tag = as; return <Tag className={className + (multiline ? " whitespace-pre-line" : "")} style={style}>{v}</Tag>; }
  return multiline
    ? <textarea value={v} onChange={(e) => onChange?.(e.target.value)} rows={rows} className={`${className} block w-full resize-y ${ED}`} style={style} />
    : <input value={v} onChange={(e) => onChange?.(e.target.value)} className={`${className} block w-full ${ED}`} style={style} />;
}
function ImgEdit({ url, editando, onUpload, className = "", fallback }: {
  url: string; editando: boolean; onUpload: (f: File) => void; className?: string; fallback?: React.ReactNode;
}) {
  return (
    <div className="group relative inline-block">
      {url ? <img src={url} alt="" className={className} /> : fallback}
      {editando && (
        <label className="absolute inset-0 grid cursor-pointer place-items-center rounded-[inherit] bg-black/40 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">Cambiar
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }} />
        </label>
      )}
    </div>
  );
}
function Contacto({ label, v, editando, onChange, href }: {
  label: string; v: string; editando: boolean; onChange: (s: string) => void; href?: string;
}) {
  const inner = (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      {editando ? <input value={v} onChange={(e) => onChange(e.target.value)} className={`mt-1 block w-full text-center ${ED}`} /> : <div className="mt-1 font-medium text-slate-700">{v || "—"}</div>}
    </div>
  );
  return !editando && v && href ? <a href={href} className="block hover:opacity-90">{inner}</a> : inner;
}

// ---- Modales ---------------------------------------------------------------
function LoginModal({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const [usuario, setUsuario] = useState(""); const [clave, setClave] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null); useEffect(() => { ref.current?.focus(); }, []);
  async function entrar() {
    setBusy(true); setErr(null);
    try { const r = await fetch("/api/asociacion/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario, clave }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { setErr(d.error || "No se pudo entrar."); return; } onOk(); }
    catch { setErr("Error de red."); } finally { setBusy(false); }
  }
  return (
    <Modal onClose={onClose} titulo="Editar el sitio">
      <p className="text-sm text-slate-500">Ingresa el usuario y clave de edición.</p>
      <input ref={ref} value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario" className="mt-4 block w-full rounded-lg border border-slate-300 px-3 py-2" />
      <input value={clave} type="password" onChange={(e) => setClave(e.target.value)} onKeyDown={(e) => e.key === "Enter" && entrar()} placeholder="Clave" className="mt-3 block w-full rounded-lg border border-slate-300 px-3 py-2" />
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
        <button onClick={entrar} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-slate-900" style={{ background: GOLD }}>{busy ? "Entrando…" : "Entrar"}</button>
      </div>
    </Modal>
  );
}
function SugerirModal({ onClose }: { onClose: () => void }) {
  const [tema, setTema] = useState(""); const [nombre, setNombre] = useState(""); const [email, setEmail] = useState("");
  const [ok, setOk] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function enviar() {
    setBusy(true); setErr(null);
    try { const r = await fetch("/api/asociacion/sugerencias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tema, nombre, email }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { setErr(d.error || "No se pudo enviar."); return; } setOk(true); }
    catch { setErr("Error de red."); } finally { setBusy(false); }
  }
  return (
    <Modal onClose={onClose} titulo="Sugiere un próximo curso">
      {ok ? (
        <div className="py-4 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full text-2xl font-bold text-slate-900" style={{ background: GOLD }}>✓</div><p className="mt-3 font-semibold text-slate-700">¡Gracias por tu sugerencia!</p><button onClick={onClose} className="mt-4 rounded-lg px-5 py-2 text-sm font-bold text-slate-900" style={{ background: GOLD }}>Cerrar</button></div>
      ) : (
        <>
          <p className="text-sm text-slate-500">¿Qué curso te gustaría que dictemos? Tu opinión nos ayuda a planificar.</p>
          <textarea value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Tema o curso que sugieres *" rows={3} className="mt-4 block w-full rounded-lg border border-slate-300 px-3 py-2" />
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre (opcional)" className="mt-3 block w-full rounded-lg border border-slate-300 px-3 py-2" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Tu correo (opcional)" className="mt-3 block w-full rounded-lg border border-slate-300 px-3 py-2" />
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
            <button onClick={enviar} disabled={busy} className="rounded-lg px-5 py-2 text-sm font-bold text-slate-900" style={{ background: GOLD }}>{busy ? "Enviando…" : "Enviar sugerencia"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}
function SugerenciasModal({ onClose }: { onClose: () => void }) {
  const [lista, setLista] = useState<any[] | null>(null);
  useEffect(() => { fetch("/api/asociacion/sugerencias", { cache: "no-store" }).then((r) => r.json()).then((d) => setLista(d.sugerencias || [])).catch(() => setLista([])); }, []);
  return (
    <Modal onClose={onClose} titulo="Sugerencias de cursos" ancho>
      {!lista ? <p className="text-sm text-slate-400">Cargando…</p> : lista.length === 0 ? <p className="text-sm text-slate-400">Aún no hay sugerencias.</p> : (
        <ul className="max-h-[60vh] space-y-2 overflow-auto">
          {lista.map((s, i) => (
            <li key={i} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm text-slate-800">{s.tema}</p>
              <p className="mt-1 text-xs text-slate-400">{s.nombre || "Anónimo"}{s.email ? ` · ${s.email}` : ""} · {new Date(s.at).toLocaleDateString("es-PE")}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 text-right"><button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100">Cerrar</button></div>
    </Modal>
  );
}
function Modal({ titulo, children, onClose, ancho }: { titulo: string; children: React.ReactNode; onClose: () => void; ancho?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className={`w-full ${ancho ? "max-w-lg" : "max-w-sm"} rounded-2xl bg-white p-6 shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold" style={{ color: NAVY }}>{titulo}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}
