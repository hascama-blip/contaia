"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface NavLink { href: string; label: string }

// Header: navegación principal a la izquierda, "+ Nuevo cliente" como acción, y
// un MENÚ DESPLEGABLE (hacia abajo) bajo el usuario con Supremo, Adquirir
// módulos, Cambiar contraseña y Salir. En la barra se muestra solo el primer
// nombre; el nombre completo va como encabezado del desplegable.
export function HeaderNav({
  nombre,
  admin,
  supremo,
  equipo,
  plan,
}: {
  nombre: string;
  admin: boolean;
  supremo: boolean;
  equipo?: boolean;
  /** Plan del estudio: el link de planes solo se muestra en básico/regular
   *  (no en Premium = mejor plan, ni en Plan de Equipo, ni para el supremo). */
  plan?: "basico" | "regular" | "premium" | "equipo";
}) {
  const [open, setOpen] = useState(false);        // menú móvil (hamburguesa)
  const [menuUser, setMenuUser] = useState(false); // desplegable del usuario
  const [busy, setBusy] = useState(false);
  const refUser = useRef<HTMLDivElement>(null);
  const mostrarPlanes = !supremo && (plan === "basico" || plan === "regular" || !plan);

  // "Nombre Apellido · operador" → base = nombre completo, sufijo = rol (si viene).
  const [base = "", sufijo] = nombre.split(" · ");
  const primerNombre = base.trim().split(/\s+/)[0] || "Usuario";
  const nombreCorto = sufijo ? `${primerNombre} · ${sufijo}` : primerNombre;
  const iniciales = base.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "U";

  const nav: NavLink[] = [
    { href: "/", label: "Inicio" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/clientes", label: "Clientes" },
    ...(admin && equipo ? [{ href: "/equipo", label: "Equipo" }, { href: "/actividad", label: "Actividad" }] : []),
  ];
  const menu: NavLink[] = [
    ...(supremo ? [{ href: "/supremo", label: "Supremo" }] : []),
    ...(mostrarPlanes ? [{ href: "/planes", label: "Adquirir módulos" }] : []),
    { href: "/cuenta", label: "Cambiar contraseña" },
  ];
  const estiloItem = (href: string) =>
    href === "/supremo" ? "font-semibold text-brand-700" : href === "/planes" ? "font-semibold text-accent-600" : "text-slate-700";

  // Cierra el desplegable al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!menuUser) return;
    const onDoc = (e: MouseEvent) => { if (refUser.current && !refUser.current.contains(e.target as Node)) setMenuUser(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuUser(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [menuUser]);

  async function salir() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* */ }
    try { localStorage.removeItem("mostrar_planes"); } catch { /* */ }
    // Navegación COMPLETA (no suave): el layout del servidor relee las cookies
    // y no queda el header de la sesión anterior sobre la pantalla de login.
    window.location.replace("/login");
  }

  return (
    <>
      {/* Navegación de escritorio */}
      <nav className="hidden items-center gap-0.5 text-sm md:flex lg:gap-1.5">
        {nav.map((l) => (
          <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 hover:bg-slate-100">
            {l.label}
          </Link>
        ))}
        {admin && (
          <Link href="/clientes/nuevo" className="btn-primary ml-2">
            + Nuevo cliente
          </Link>
        )}

        {/* Usuario → menú desplegable hacia abajo */}
        <div ref={refUser} className="relative ml-2 border-l border-slate-200 pl-3">
          <button
            onClick={() => setMenuUser((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuUser}
            className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100"
            title={base}
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">{iniciales}</span>
            <span className="text-sm text-slate-700">{nombreCorto}</span>
            <svg viewBox="0 0 20 20" className={`h-4 w-4 text-slate-400 transition-transform ${menuUser ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {menuUser && (
            <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              <div className="truncate border-b border-slate-100 px-3 py-2 text-xs text-slate-500" title={base}>{base}</div>
              {menu.map((l) => (
                <Link key={l.href} href={l.href} role="menuitem" onClick={() => setMenuUser(false)} className={`block px-3 py-2 text-sm hover:bg-slate-50 ${estiloItem(l.href)}`}>
                  {l.label}
                </Link>
              ))}
              <button onClick={salir} disabled={busy} role="menuitem" className="block w-full border-t border-slate-100 px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50">
                {busy ? "Saliendo…" : "Salir"}
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Botón hamburguesa (móvil) */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
        aria-label="Menú"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          {open ? <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /> : <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />}
        </svg>
      </button>

      {/* Menú desplegable (móvil) */}
      {open && (
        <div className="absolute inset-x-0 top-full border-b border-slate-200 bg-white shadow-lg md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 text-sm">
            <div className="mb-1 flex items-center gap-2 border-b border-slate-100 pb-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">{iniciales}</span>
              <span className="text-sm font-medium text-slate-700">{nombreCorto}</span>
            </div>
            {nav.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-slate-700 hover:bg-slate-100">
                {l.label}
              </Link>
            ))}
            {admin && (
              <Link href="/clientes/nuevo" onClick={() => setOpen(false)} className="btn-primary mt-1 text-center">
                + Nuevo cliente
              </Link>
            )}
            <div className="my-1 border-t border-slate-100" />
            {menu.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={`rounded-lg px-3 py-2.5 hover:bg-slate-100 ${estiloItem(l.href)}`}>
                {l.label}
              </Link>
            ))}
            <button onClick={salir} disabled={busy} className="mt-1 rounded-lg px-3 py-2.5 text-left text-slate-500 hover:bg-slate-100">
              {busy ? "Saliendo…" : "Salir"}
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
