"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface NavLink { href: string; label: string }

export function HeaderNav({
  nombre,
  admin,
  supremo,
}: {
  nombre: string;
  admin: boolean;
  supremo: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const links: NavLink[] = [
    { href: "/", label: "Inicio" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/clientes", label: "Clientes" },
    ...(admin ? [{ href: "/equipo", label: "Equipo" }, { href: "/actividad", label: "Actividad" }] : []),
    ...(supremo ? [{ href: "/supremo", label: "Supremo" }] : []),
  ];

  const iniciales = nombre.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "U";

  async function salir() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      {/* Navegación de escritorio */}
      <nav className="hidden items-center gap-1 text-sm md:flex">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-2 hover:bg-slate-100 ${l.href === "/supremo" ? "font-semibold text-brand-700" : ""}`}>
            {l.label}
          </Link>
        ))}
        {admin && (
          <Link href="/clientes/nuevo" className="btn-primary ml-2">
            + Nuevo cliente
          </Link>
        )}
        <div className="ml-2 flex items-center gap-2 border-l border-slate-200 pl-3">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">{iniciales}</span>
          <span className="hidden text-sm text-slate-600 lg:inline">{nombre}</span>
          <button onClick={salir} disabled={busy} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100" title="Cerrar sesión">
            {busy ? "…" : "Salir"}
          </button>
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
              <span className="text-sm font-medium text-slate-700">{nombre}</span>
            </div>
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`rounded-lg px-3 py-2.5 hover:bg-slate-100 ${l.href === "/supremo" ? "font-semibold text-brand-700" : "text-slate-700"}`}
              >
                {l.label}
              </Link>
            ))}
            {admin && (
              <Link href="/clientes/nuevo" onClick={() => setOpen(false)} className="btn-primary mt-1 text-center">
                + Nuevo cliente
              </Link>
            )}
            <button onClick={salir} disabled={busy} className="mt-1 rounded-lg px-3 py-2.5 text-left text-slate-500 hover:bg-slate-100">
              {busy ? "Saliendo…" : "Salir"}
            </button>
          </nav>
        </div>
      )}
    </>
  );
}
