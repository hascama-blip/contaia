import type { Metadata } from "next";
import Link from "next/link";
import { LogoAsenco } from "@/components/Logo";
import { HeaderNav } from "@/components/HeaderNav";
import { getCurrentUser, esAdmin, esSupremo, ensureSupremo } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radar Tributar IA",
  description:
    "Plataforma para consultar el estado tributario SUNAT de clientes, analizar documentos y generar informes.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Garantiza/reconcilia la cuenta supremo en cada carga: si la cuenta del
  // correo supremo ya existía (p. ej. registrada antes), aquí se le asigna el
  // rol supremo aunque la sesión sea anterior al cambio. Nunca rompe el render.
  await ensureSupremo().catch(() => {});
  const user = await getCurrentUser();
  const admin = esAdmin(user);
  const supremo = esSupremo(user);
  return (
    <html lang="es">
      <body>
        {user && (
          <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
              <Link href="/" className="flex shrink-0 items-center" translate="no">
                <LogoAsenco />
              </Link>
              <HeaderNav
                nombre={user.nombre + (admin ? "" : " · operador")}
                admin={admin}
                supremo={supremo}
              />
            </div>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-6">{children}</main>
        <footer className="no-print mx-auto max-w-6xl px-4 py-8 text-center text-xs text-slate-400">
          <span translate="no">RADAR TRIBUTAR IA · by <span className="font-bold text-brand-600">ASENCO</span></span> · Diagnóstico tributario asistido · {new Date().getFullYear()}
        </footer>
      </body>
    </html>
  );
}
