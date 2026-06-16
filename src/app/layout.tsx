import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ContaIA — Diagnóstico Tributario SUNAT",
  description:
    "Plataforma para consultar el estado tributario SUNAT de clientes, analizar documentos y generar informes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        <header className="no-print sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
                C
              </span>
              <span className="text-lg font-semibold text-slate-800">
                Conta<span className="text-brand-600">IA</span>
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/" className="rounded-lg px-3 py-2 hover:bg-slate-100">
                Dashboard
              </Link>
              <Link
                href="/clientes"
                className="rounded-lg px-3 py-2 hover:bg-slate-100"
              >
                Clientes
              </Link>
              <Link href="/clientes/nuevo" className="btn-primary ml-2">
                + Nuevo cliente
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="no-print mx-auto max-w-6xl px-4 py-8 text-center text-xs text-slate-400">
          ContaIA · Diagnóstico tributario asistido · {new Date().getFullYear()}
        </footer>
      </body>
    </html>
  );
}
