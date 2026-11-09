"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoAsenco } from "./Logo";
import SesionGuard, { anunciarSesion } from "./SesionGuard";

// ============================================================
//  Chrome de la app: BARRA LATERAL (azul marino) + BARRA SUPERIOR
// ============================================================
// Lateral: logo, navegación (Inicio / Dashboard / Clientes / Equipo /
// Actividad) con el ítem activo resaltado en dorado, y abajo el usuario con
// su menú (Supremo / Adquirir módulos / Alertas / Salir) más los
// íconos de ajustes y salir. Superior: búsqueda de clientes, "+ Nuevo cliente"
// y la campana de recordatorios. En móvil la lateral se vuelve un cajón.

interface NavLink { href: string; label: string; icon: IconName }
type IconName = "home" | "grid" | "users" | "activity" | "tools" | "building";

export interface AppShellProps {
  /** Id del usuario de esta pantalla (para detectar cambio de cuenta en otra pestaña). */
  uid: string;
  nombre: string;
  admin: boolean;
  supremo: boolean;
  equipo?: boolean;
  soloRtp?: boolean;
  plan?: "basico" | "regular" | "premium" | "equipo";
  children: React.ReactNode;
}

function Icono({ name, className = "h-[18px] w-[18px]" }: { name: IconName | "search" | "bell" | "gear" | "logout" | "chevron" | "menu" | "close" | "plus"; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "home": return <svg viewBox="0 0 24 24" className={className} {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5" /><path d="M10 20v-5h4v5" /></svg>;
    case "grid": return <svg viewBox="0 0 24 24" className={className} {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></svg>;
    case "users": return <svg viewBox="0 0 24 24" className={className} {...p}><circle cx="9.5" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.9-5.5 6.5-5.5S16 16.7 16 20" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14.7c2 .6 3 2.3 3 5.3" /></svg>;
    case "activity": return <svg viewBox="0 0 24 24" className={className} {...p}><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></svg>;
    case "tools": return <svg viewBox="0 0 24 24" className={className} {...p}><path d="M14.5 6.5a4 4 0 0 0 5 5L9 22l-3-3L16.5 8.5" /><path d="M14 6l4 4" /></svg>;
    case "building": return <svg viewBox="0 0 24 24" className={className} {...p}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></svg>;
    case "search": return <svg viewBox="0 0 24 24" className={className} {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>;
    case "bell": return <svg viewBox="0 0 24 24" className={className} {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>;
    case "gear": return <svg viewBox="0 0 24 24" className={className} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
    case "logout": return <svg viewBox="0 0 24 24" className={className} {...p}><path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10" /><path d="M14 8l4 4-4 4" /><path d="M18 12H9" /></svg>;
    case "chevron": return <svg viewBox="0 0 24 24" className={className} {...p}><path d="m6 9 6 6 6-6" /></svg>;
    case "menu": return <svg viewBox="0 0 24 24" className={className} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case "close": return <svg viewBox="0 0 24 24" className={className} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case "plus": return <svg viewBox="0 0 24 24" className={className} {...p}><path d="M12 5v14M5 12h14" /></svg>;
  }
}

async function cerrarSesion(setBusy: (b: boolean) => void) {
  setBusy(true);
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* */ }
  try { localStorage.removeItem("mostrar_planes"); } catch { /* */ }
  anunciarSesion(null); // las demás pestañas se bloquean
  // Navegación COMPLETA: el layout del servidor relee las cookies y no queda
  // el chrome de la sesión anterior sobre la pantalla de login.
  window.location.replace("/login");
}

export default function AppShell({ uid, nombre, admin, supremo, equipo, soloRtp, plan, children }: AppShellProps) {
  const pathname = usePathname() || "/";
  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState(false);

  // "Nombre Apellido · operador" → base = nombre completo, sufijo = rol.
  const [base = "", sufijo] = nombre.split(" · ");
  const primerNombre = base.trim().split(/\s+/)[0] || "Usuario";
  const nombreCorto = sufijo ? `${primerNombre} · ${sufijo}` : primerNombre;
  const inicial = (base.trim()[0] || "U").toUpperCase();
  const mostrarPlanes = !supremo && !soloRtp && (plan === "basico" || plan === "regular" || !plan);

  const nav: NavLink[] = soloRtp
    ? [
        { href: "/rtputilitarios", label: "Utilitarios RTP", icon: "tools" },
        { href: "/clientes", label: "Empresas", icon: "building" },
      ]
    : [
        { href: "/", label: "Inicio", icon: "home" },
        { href: "/dashboard", label: "Dashboard", icon: "grid" },
        { href: "/clientes", label: "Clientes", icon: "users" },
        ...(admin && equipo ? [{ href: "/equipo", label: "Equipo", icon: "users" as const }, { href: "/actividad", label: "Actividad", icon: "activity" as const }] : []),
      ];
  const menu: { href: string; label: string; clase: string }[] = soloRtp ? [] : [
    ...(supremo ? [{ href: "/supremo", label: "Supremo", clase: "font-semibold text-accent-300" }] : []),
    ...(mostrarPlanes ? [{ href: "/planes", label: "Adquirir módulos", clase: "font-semibold text-accent-300" }] : []),
    { href: "/alertas", label: "Alertas al celular", clase: "text-slate-100" },
  ];
  const activo = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const inicio = !soloRtp && pathname === "/";

  // Cierra el cajón móvil al navegar.
  useEffect(() => { setDrawer(false); }, [pathname]);

  const lateral = (
    <SidebarContenido
      nav={nav} menu={menu} activo={activo} base={base} nombreCorto={nombreCorto} inicial={inicial}
      busy={busy} onSalir={() => cerrarSesion(setBusy)} homeHref={soloRtp ? "/rtputilitarios" : "/"}
      nuevoCliente={admin}
    />
  );

  return (
    <div className="min-h-screen">
      <SesionGuard uid={uid} />
      {/* Barra lateral (escritorio) */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-brand-800 text-white md:flex">
        {lateral}
      </aside>

      {/* Cajón (móvil) */}
      {drawer && (
        <div className="no-print fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-brand-800 text-white shadow-2xl">
            <button onClick={() => setDrawer(false)} className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-300 hover:bg-white/10" aria-label="Cerrar menú">
              <Icono name="close" />
            </button>
            {lateral}
          </aside>
        </div>
      )}

      {/* Barra superior */}
      <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur md:pl-60">
        <div className="flex h-16 items-center gap-3 px-3 sm:px-5">
          <button onClick={() => setDrawer(true)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Menú">
            <Icono name="menu" className="h-6 w-6" />
          </button>
          <Link href={soloRtp ? "/rtputilitarios" : "/"} className="md:hidden" translate="no"><LogoAsenco size="sm" /></Link>

          {!soloRtp && <Buscador />}

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {admin && (
              <Link href="/clientes/nuevo" className="btn-accent !rounded-xl !px-3 !py-2.5 whitespace-nowrap sm:!px-4" title="Nuevo cliente">
                <Icono name="plus" className="h-4 w-4" /><span className="hidden sm:inline">Nuevo cliente</span>
              </Link>
            )}
            {!soloRtp && <Campana />}
          </div>
        </div>
      </header>

      {/* Contenido (fondo claro siempre). El Inicio ocupa EXACTAMENTE una
          pantalla en escritorio: sin desplazamiento y sin pie de página. */}
      <div className="md:pl-60">
        <main className={`mx-auto px-3 py-5 sm:px-5 sm:py-6 ${inicio ? "max-w-[1600px] lg:h-[calc(100vh-4rem)] lg:overflow-hidden lg:py-4" : "max-w-6xl"}`}>{children}</main>
        <footer className={`no-print mx-auto max-w-6xl px-4 py-8 text-center text-xs text-slate-400 ${inicio ? "lg:hidden" : ""}`}>
          <span translate="no">RADAR TRIBUTAR IA</span> · Diagnóstico tributario asistido · {new Date().getFullYear()}
          <br />
          <span translate="no">© {new Date().getFullYear()} · Desarrollado por <span className="font-semibold text-slate-500">KALLPA TEC</span></span>
        </footer>
      </div>
    </div>
  );
}

function SidebarContenido({ nav, menu, activo, base, nombreCorto, inicial, busy, onSalir, homeHref, nuevoCliente }: {
  nav: NavLink[]; menu: { href: string; label: string; clase: string }[]; activo: (h: string) => boolean;
  base: string; nombreCorto: string; inicial: string; busy: boolean; onSalir: () => void; homeHref: string; nuevoCliente: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [abierto]);

  return (
    <>
      <div className="flex h-16 items-center px-4">
        <Link href={homeHref} translate="no"><LogoAsenco dark size="sm" /></Link>
      </div>
      <nav className="mt-2 flex-1 space-y-1 px-3">
        {nav.map((l) => {
          const act = activo(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition ${
                act ? "border border-accent-400 bg-white/10 font-semibold text-white" : "border border-transparent text-slate-200 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icono name={l.icon} className={`h-[18px] w-[18px] ${act ? "text-accent-300" : "text-slate-300"}`} />
              {l.label}
            </Link>
          );
        })}
      </nav>

      {/* Usuario + menú (se despliega hacia ARRIBA) */}
      <div ref={ref} className="relative px-3 pb-2">
        {abierto && (
          <div role="menu" className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-xl border border-white/10 bg-brand-900 py-1 shadow-xl">
            <div className="truncate border-b border-white/10 px-3 py-2 text-xs text-slate-300" title={base}>{base}</div>
            {menu.map((l) => (
              <Link key={l.href} href={l.href} role="menuitem" onClick={() => setAbierto(false)} className={`block px-3 py-2 text-sm hover:bg-white/10 ${l.clase}`}>
                {l.label}
              </Link>
            ))}
            <button onClick={onSalir} disabled={busy} role="menuitem" className="block w-full border-t border-white/10 px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/10">
              {busy ? "Saliendo…" : "Salir"}
            </button>
          </div>
        )}
        <button
          onClick={() => setAbierto((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={abierto}
          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-white/5"
          title={base}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-brand-800">{inicial}</span>
          <span className="flex-1 truncate text-sm text-slate-100">{nombreCorto}</span>
          <Icono name="chevron" className={`h-4 w-4 text-slate-400 transition-transform ${abierto ? "rotate-180" : ""}`} />
        </button>
      </div>
      <div className="flex items-center justify-between border-t border-white/10 px-5 py-3">
        <Link href="/alertas" className="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white" title="Configurar alertas">
          <Icono name="gear" className="h-5 w-5" />
        </Link>
        <button onClick={onSalir} disabled={busy} className="rounded-lg p-1 text-slate-300 hover:bg-white/10 hover:text-white" title="Salir">
          <Icono name="logout" className="h-5 w-5" />
        </button>
      </div>
      {nuevoCliente && (
        <div className="px-3 pb-3">
          <Link href="/clientes/nuevo" className="btn-accent w-full !rounded-xl">
            <Icono name="plus" className="h-4 w-4" /> Nuevo cliente
          </Link>
        </div>
      )}
    </>
  );
}

// Búsqueda de clientes (razón social o RUC): sugiere al escribir y abre la ficha.
interface ClienteMin { id: string; razonSocial: string; ruc: string }
function Buscador() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ClienteMin[] | null>(null);
  const [foco, setFoco] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function cargar() {
    if (lista) return;
    try {
      const res = await fetch("/api/clientes", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setLista(Array.isArray(data.clientes) ? data.clientes.map((c: any) => ({ id: c.id, razonSocial: c.razonSocial, ruc: c.ruc })) : []);
    } catch { setLista([]); }
  }
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setFoco(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const t = q.trim().toLowerCase();
  const res = t && lista ? lista.filter((c) => c.razonSocial.toLowerCase().includes(t) || c.ruc.includes(t)).slice(0, 8) : [];

  return (
    <div ref={ref} className="relative hidden w-full max-w-md sm:block">
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-brand-400 focus-within:bg-white">
        <Icono name="search" className="h-4 w-4 text-slate-400" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setFoco(true); }}
          onFocus={() => { setFoco(true); cargar(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && res[0]) { router.push(`/clientes/${res[0].id}`); setFoco(false); setQ(""); } if (e.key === "Escape") setFoco(false); }}
          placeholder="Búsqueda"
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
          aria-label="Buscar cliente"
        />
      </div>
      {foco && t && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {lista === null ? (
            <div className="px-3 py-2 text-xs text-slate-400">Buscando…</div>
          ) : res.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Sin coincidencias</div>
          ) : res.map((c) => (
            <Link key={c.id} href={`/clientes/${c.id}`} onClick={() => { setFoco(false); setQ(""); }} className="block px-3 py-2 text-sm hover:bg-slate-50">
              <span className="font-medium text-slate-800">{c.razonSocial}</span>
              <span className="ml-2 text-xs text-slate-400">RUC {c.ruc}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Campana: recordatorios de buzón pendientes (los mismos del banner del Inicio).
function Campana() {
  const [n, setN] = useState(0);
  useEffect(() => {
    fetch("/api/recordatorios", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.recordatorios)) setN(d.recordatorios.length); })
      .catch(() => {});
  }, []);
  return (
    <Link href="/alertas" className="relative grid h-10 w-10 place-items-center rounded-xl text-slate-600 hover:bg-slate-100" title={n ? `${n} recordatorio(s) de buzón · configurar alertas` : "Alertas al celular"}>
      <Icono name="bell" className="h-5 w-5" />
      {n > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />}
    </Link>
  );
}
