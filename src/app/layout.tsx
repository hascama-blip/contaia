import type { Metadata } from "next";
import Link from "next/link";
import { LogoAsenco } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { getCurrentUser, esAdmin, esSupremo } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "RADAR TRIBUTARIO — by ASENCO",
  description:
    "Plataforma para consultar el estado tributario SUNAT de clientes, analizar documentos y generar informes.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const admin = esAdmin(user);
  const supremo = esSupremo(user);
  return (
    <html lang="es">
      <body>
        {user && (
          <header className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <Link href="/" className="flex items-center">
                <LogoAsenco />
              </Link>
              <nav className="flex items-center gap-1 text-sm">
                <Link href="/" className="rounded-lg px-3 py-2 hover:bg-slate-100">
                  Inicio
                </Link>
                <Link href="/dashboard" className="rounded-lg px-3 py-2 hover:bg-slate-100">
                  Dashboard
                </Link>
                <Link href="/clientes" className="rounded-lg px-3 py-2 hover:bg-slate-100">
                  Clientes
                </Link>
                {admin && (
                  <Link href="/equipo" className="rounded-lg px-3 py-2 hover:bg-slate-100">
                    Equipo
                  </Link>
                )}
                {admin && (
                  <Link href="/actividad" className="rounded-lg px-3 py-2 hover:bg-slate-100">
                    Actividad
                  </Link>
                )}
                {supremo && (
                  <Link href="/supremo" className="rounded-lg px-3 py-2 font-semibold text-brand-700 hover:bg-slate-100">
                    Supremo
                  </Link>
                )}
                {admin && (
                  <Link href="/clientes/nuevo" className="btn-primary ml-2">
                    + Nuevo cliente
                  </Link>
                )}
                <UserMenu nombre={user.nombre + (admin ? "" : " · operador")} />
              </nav>
            </div>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="no-print mx-auto max-w-6xl px-4 py-8 text-center text-xs text-slate-400">
          RADAR TRIBUTARIO · by ASENCO · Diagnóstico tributario asistido · {new Date().getFullYear()}
        </footer>
      </body>
    </html>
  );
}
