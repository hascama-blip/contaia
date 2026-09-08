"use client";

import { useEffect, useRef, useState } from "react";

interface Servicio { titulo: string; texto: string; icono: string }
interface Contenido {
  marca: string; logo: string;
  heroTitulo: string; heroSubtitulo: string; heroBoton: string; heroImagen: string;
  nosotrosTitulo: string; nosotrosTexto: string; nosotrosImagen: string;
  serviciosTitulo: string; servicios: Servicio[];
  galeriaTitulo: string; galeria: string[];
  videoTitulo: string; video: string;
  contactoTitulo: string; contactoTexto: string;
  telefono: string; email: string; direccion: string; facebook: string;
}

const ED = "rounded border border-dashed border-current/40 bg-transparent px-1.5 py-0.5 outline-none focus:border-current focus:bg-black/5";

export default function AsociacionSitio({ inicial, habilitada }: { inicial: Contenido; habilitada: boolean }) {
  const [c, setC] = useState<Contenido>(inicial);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    fetch("/api/asociacion/session", { cache: "no-store" })
      .then((r) => r.json()).then((d) => { if (d?.editando) setEditando(true); }).catch(() => {});
  }, []);

  const set = (k: keyof Contenido, v: any) => setC((p) => ({ ...p, [k]: v }));

  async function subir(file: File): Promise<string | null> {
    const fd = new FormData(); fd.append("archivo", file);
    const r = await fetch("/api/asociacion/media", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error || "No se pudo subir."); return null; }
    return d.url as string;
  }
  async function guardar() {
    setGuardando(true); setMsg(null);
    try {
      const r = await fetch("/api/asociacion", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contenido: c }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || "No se pudo guardar."); return; }
      setMsg("✅ Cambios guardados.");
      setTimeout(() => setMsg(null), 2500);
    } catch { setMsg("Error de red al guardar."); }
    finally { setGuardando(false); }
  }
  async function salirEdicion() {
    await fetch("/api/asociacion/login", { method: "DELETE" }).catch(() => {});
    setEditando(false); window.location.reload();
  }

  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* NAV */}
      <header className="sticky top-0 z-30 border-b border-emerald-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <a href="#inicio" className="flex items-center gap-2">
            <ImgEdit url={c.logo} editando={editando} onUpload={async (f) => { const u = await subir(f); if (u) set("logo", u); }}
              className="h-10 w-10 rounded-full object-cover" fallback={<span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-600 text-lg font-bold text-white">A</span>} />
            <Txt v={c.marca} editando={editando} onChange={(v) => set("marca", v)} className="text-lg font-extrabold text-emerald-800" />
          </a>
          <nav className="hidden items-center gap-1 text-sm font-medium text-slate-600 sm:flex">
            <a href="#nosotros" className="rounded-lg px-3 py-2 hover:bg-emerald-50">Nosotros</a>
            <a href="#servicios" className="rounded-lg px-3 py-2 hover:bg-emerald-50">Beneficios</a>
            <a href="#galeria" className="rounded-lg px-3 py-2 hover:bg-emerald-50">Galería</a>
            <a href="#contacto" className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">Contacto</a>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section id="inicio" className="relative flex min-h-[70vh] items-center justify-center overflow-hidden">
        {c.heroImagen
          ? <img src={c.heroImagen} alt="" className="absolute inset-0 h-full w-full object-cover" />
          : <div className="absolute inset-0 bg-gradient-to-br from-emerald-600 to-teal-700" />}
        <div className="absolute inset-0 bg-black/45" />
        <div className="relative mx-auto max-w-3xl px-4 py-24 text-center text-white">
          <Txt v={c.heroTitulo} editando={editando} onChange={(v) => set("heroTitulo", v)} as="h1" multiline className="text-4xl font-extrabold leading-tight drop-shadow sm:text-5xl" />
          <Txt v={c.heroSubtitulo} editando={editando} onChange={(v) => set("heroSubtitulo", v)} multiline className="mx-auto mt-4 max-w-2xl text-lg text-white/90" />
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="#nosotros" className="rounded-full bg-emerald-500 px-7 py-3 text-base font-semibold text-white shadow-lg hover:bg-emerald-400">
              <Txt v={c.heroBoton} editando={editando} onChange={(v) => set("heroBoton", v)} as="span" />
            </a>
            {editando && <UploadBtn label="Cambiar fondo" onUpload={async (f) => { const u = await subir(f); if (u) set("heroImagen", u); }} light />}
          </div>
        </div>
      </section>

      {/* NOSOTROS */}
      <section id="nosotros" className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <Txt v={c.nosotrosTitulo} editando={editando} onChange={(v) => set("nosotrosTitulo", v)} as="h2" className="text-3xl font-bold text-emerald-800" />
            <Txt v={c.nosotrosTexto} editando={editando} onChange={(v) => set("nosotrosTexto", v)} multiline className="mt-4 whitespace-pre-line text-lg leading-relaxed text-slate-600" rows={6} />
          </div>
          <ImgEdit url={c.nosotrosImagen} editando={editando} onUpload={async (f) => { const u = await subir(f); if (u) set("nosotrosImagen", u); }}
            className="aspect-[4/3] w-full rounded-2xl object-cover shadow-md"
            fallback={<div className="grid aspect-[4/3] w-full place-items-center rounded-2xl bg-emerald-50 text-emerald-300">Imagen</div>} />
        </div>
      </section>

      {/* SERVICIOS / BENEFICIOS */}
      <section id="servicios" className="bg-emerald-50/60 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <Txt v={c.serviciosTitulo} editando={editando} onChange={(v) => set("serviciosTitulo", v)} as="h2" className="text-center text-3xl font-bold text-emerald-800" />
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {c.servicios.map((s, i) => (
              <div key={i} className="relative rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm">
                {editando && (
                  <button onClick={() => set("servicios", c.servicios.filter((_, j) => j !== i))}
                    className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-red-100 text-red-600 hover:bg-red-200" title="Quitar">×</button>
                )}
                <Txt v={s.icono} editando={editando} onChange={(v) => set("servicios", c.servicios.map((x, j) => j === i ? { ...x, icono: v } : x))} as="div" className="text-4xl" />
                <Txt v={s.titulo} editando={editando} onChange={(v) => set("servicios", c.servicios.map((x, j) => j === i ? { ...x, titulo: v } : x))} as="h3" className="mt-3 text-lg font-bold text-slate-800" />
                <Txt v={s.texto} editando={editando} onChange={(v) => set("servicios", c.servicios.map((x, j) => j === i ? { ...x, texto: v } : x))} multiline className="mt-2 text-slate-600" />
              </div>
            ))}
            {editando && (
              <button onClick={() => set("servicios", [...c.servicios, { icono: "⭐", titulo: "Nuevo beneficio", texto: "Descripción" }])}
                className="grid min-h-[140px] place-items-center rounded-2xl border-2 border-dashed border-emerald-300 text-emerald-600 hover:bg-emerald-50">+ Agregar beneficio</button>
            )}
          </div>
        </div>
      </section>

      {/* GALERÍA */}
      <section id="galeria" className="mx-auto max-w-6xl px-4 py-16">
        <Txt v={c.galeriaTitulo} editando={editando} onChange={(v) => set("galeriaTitulo", v)} as="h2" className="text-center text-3xl font-bold text-emerald-800" />
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {c.galeria.map((url, i) => (
            <div key={i} className="group relative aspect-square overflow-hidden rounded-xl bg-slate-100 shadow-sm">
              <img src={url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
              {editando && (
                <button onClick={() => set("galeria", c.galeria.filter((_, j) => j !== i))}
                  className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-red-600/90 text-white opacity-0 transition group-hover:opacity-100" title="Quitar">×</button>
              )}
            </div>
          ))}
          {editando && (
            <label className="grid aspect-square cursor-pointer place-items-center rounded-xl border-2 border-dashed border-emerald-300 text-emerald-600 hover:bg-emerald-50">
              + Foto
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const u = await subir(f); if (u) set("galeria", [...c.galeria, u]); } e.currentTarget.value = ""; }} />
            </label>
          )}
        </div>
        {c.galeria.length === 0 && !editando && <p className="mt-6 text-center text-slate-400">Aún no hay fotos.</p>}
      </section>

      {/* VIDEO */}
      {(c.video || editando) && (
        <section className="bg-slate-900 py-16 text-white">
          <div className="mx-auto max-w-4xl px-4 text-center">
            <Txt v={c.videoTitulo} editando={editando} onChange={(v) => set("videoTitulo", v)} as="h2" className="text-3xl font-bold" />
            <div className="mt-8 overflow-hidden rounded-2xl bg-black shadow-xl">
              {c.video
                ? <video src={c.video} controls playsInline className="aspect-video w-full" />
                : <div className="grid aspect-video w-full place-items-center text-slate-500">Sin video</div>}
            </div>
            {editando && (
              <div className="mt-4"><UploadBtn label={c.video ? "Cambiar video" : "Subir video"} accept="video/*" light onUpload={async (f) => { const u = await subir(f); if (u) set("video", u); }} />
                {c.video && <button onClick={() => set("video", "")} className="ml-3 text-sm text-red-300 hover:underline">Quitar</button>}
              </div>
            )}
          </div>
        </section>
      )}

      {/* CONTACTO */}
      <section id="contacto" className="mx-auto max-w-4xl px-4 py-16 text-center">
        <Txt v={c.contactoTitulo} editando={editando} onChange={(v) => set("contactoTitulo", v)} as="h2" className="text-3xl font-bold text-emerald-800" />
        <Txt v={c.contactoTexto} editando={editando} onChange={(v) => set("contactoTexto", v)} multiline className="mx-auto mt-3 max-w-2xl text-lg text-slate-600" />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Contacto icono="📞" label="Teléfono" v={c.telefono} editando={editando} onChange={(v) => set("telefono", v)} href={`tel:${c.telefono}`} />
          <Contacto icono="✉️" label="Correo" v={c.email} editando={editando} onChange={(v) => set("email", v)} href={`mailto:${c.email}`} />
          <Contacto icono="📍" label="Dirección" v={c.direccion} editando={editando} onChange={(v) => set("direccion", v)} />
        </div>
        {(c.facebook || editando) && (
          <div className="mt-6">
            {editando
              ? <Txt v={c.facebook} editando onChange={(v) => set("facebook", v)} className="mx-auto block max-w-md text-center text-emerald-700" />
              : <a href={c.facebook} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">Síguenos en Facebook →</a>}
          </div>
        )}
      </section>

      <footer className="border-t border-emerald-100 bg-emerald-50/50 py-8 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} {c.marca}. Todos los derechos reservados.
      </footer>

      {/* BARRA DE EDICIÓN flotante */}
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2">
        {msg && <span className="rounded-full bg-slate-900/90 px-3 py-2 text-xs text-white shadow-lg">{msg}</span>}
        {editando ? (
          <>
            <button onClick={guardar} disabled={guardando} className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-700 disabled:opacity-60">{guardando ? "Guardando…" : "💾 Guardar"}</button>
            <button onClick={() => window.location.reload()} className="rounded-full bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-lg ring-1 ring-slate-200 hover:bg-slate-50">↩ Deshacer</button>
            <button onClick={salirEdicion} className="rounded-full bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-lg ring-1 ring-slate-200 hover:bg-slate-50">🚪 Salir</button>
          </>
        ) : habilitada ? (
          <button onClick={() => setLoginOpen(true)} className="rounded-full bg-slate-900/80 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-slate-900">🔒 Editar</button>
        ) : null}
      </div>

      {loginOpen && !editando && (
        <LoginModal onClose={() => setLoginOpen(false)} onOk={() => { setLoginOpen(false); setEditando(true); }} />
      )}
    </div>
  );
}

// ---- Subcomponentes --------------------------------------------------------
function Txt({ v, onChange, editando, as = "p", className = "", multiline, rows = 3 }: {
  v: string; onChange?: (s: string) => void; editando: boolean; as?: any; className?: string; multiline?: boolean; rows?: number;
}) {
  if (!editando) {
    const Tag = as as any;
    return <Tag className={className + (multiline ? " whitespace-pre-line" : "")}>{v}</Tag>;
  }
  return multiline
    ? <textarea value={v} onChange={(e) => onChange?.(e.target.value)} rows={rows} className={`${className} block w-full resize-y ${ED}`} />
    : <input value={v} onChange={(e) => onChange?.(e.target.value)} className={`${className} block w-full ${ED}`} />;
}

function ImgEdit({ url, editando, onUpload, className = "", fallback }: {
  url: string; editando: boolean; onUpload: (f: File) => void; className?: string; fallback?: React.ReactNode;
}) {
  return (
    <div className="group relative inline-block">
      {url ? <img src={url} alt="" className={className} /> : fallback}
      {editando && (
        <label className="absolute inset-0 grid cursor-pointer place-items-center rounded-[inherit] bg-black/40 text-sm font-medium text-white opacity-0 transition group-hover:opacity-100">
          ⬆ Cambiar
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }} />
        </label>
      )}
    </div>
  );
}

function UploadBtn({ label, onUpload, accept = "image/*", light }: { label: string; onUpload: (f: File) => void; accept?: string; light?: boolean }) {
  return (
    <label className={`cursor-pointer rounded-full px-5 py-3 text-sm font-semibold shadow ${light ? "bg-white/90 text-slate-700 hover:bg-white" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
      ⬆ {label}
      <input type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }} />
    </label>
  );
}

function Contacto({ icono, label, v, editando, onChange, href }: { icono: string; label: string; v: string; editando: boolean; onChange: (s: string) => void; href?: string }) {
  const inner = (
    <div className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
      <div className="text-2xl">{icono}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      {editando ? <input value={v} onChange={(e) => onChange(e.target.value)} className={`mt-1 block w-full text-center ${ED}`} /> : <div className="mt-1 font-medium text-slate-700">{v || "—"}</div>}
    </div>
  );
  return !editando && v && href ? <a href={href} className="block hover:opacity-90">{inner}</a> : inner;
}

function LoginModal({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  async function entrar() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/asociacion/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario, clave }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || "No se pudo entrar."); return; }
      onOk();
    } catch { setErr("Error de red."); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-800">Editar el sitio</h3>
        <p className="mt-1 text-sm text-slate-500">Ingresa el usuario y clave de edición.</p>
        <input ref={ref} value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario" className="mt-4 block w-full rounded-lg border border-slate-300 px-3 py-2" />
        <input value={clave} type="password" onChange={(e) => setClave(e.target.value)} onKeyDown={(e) => e.key === "Enter" && entrar()} placeholder="Clave" className="mt-3 block w-full rounded-lg border border-slate-300 px-3 py-2" />
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
          <button onClick={entrar} disabled={busy} className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? "Entrando…" : "Entrar"}</button>
        </div>
      </div>
    </div>
  );
}
