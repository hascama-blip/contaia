import type { Metadata } from "next";
import Link from "next/link";
import { LogoAsenco } from "@/components/Logo";
import { HeaderNav } from "@/components/HeaderNav";
import PlanesModal from "@/components/PlanesModal";
import { SupremoProvider } from "@/components/SupremoContext";
import { getCurrentUser, esAdmin, esSupremo, esSoloRtp, ensureSupremo, ensureRtpUser, planDelEstudio } from "@/lib/auth";
import SalirBtn from "@/components/SalirBtn";
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
  await ensureRtpUser().catch(() => {});
  const user = await getCurrentUser();
  const admin = esAdmin(user);
  const supremo = esSupremo(user);
  const soloRtp = esSoloRtp(user);
  // El menú "Equipo" solo para el Plan de Equipo (o supremo).
  const equipo = user && !soloRtp ? supremo || (await planDelEstudio(user)) === "equipo" : false;
  return (
    <html lang="es">
      <body>
        {user && (
          <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-3 py-2.5 sm:px-4 sm:py-3 lg:gap-10">
              <Link href={soloRtp ? "/rtputilitarios" : "/"} className="mr-2 flex shrink-0 items-center lg:mr-6" translate="no">
                <LogoAsenco />
              </Link>
              {soloRtp ? (
                // Header MÍNIMO para el usuario restringido: sin menús, solo salir.
                <div className="flex items-center gap-3">
                  <span className="hidden text-sm text-slate-600 sm:inline">{user.nombre}</span>
                  <SalirBtn />
                </div>
              ) : (
                <HeaderNav
                  nombre={user.nombre + (admin ? "" : " · operador")}
                  admin={admin}
                  supremo={supremo}
                  equipo={equipo}
                />
              )}
            </div>
          </header>
        )}
        {user && !soloRtp && <PlanesModal />}
        <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-6">
          <SupremoProvider value={supremo}>{children}</SupremoProvider>
        </main>
        <footer className="no-print mx-auto max-w-6xl px-4 py-8 text-center text-xs text-slate-400">
          <span translate="no">RADAR TRIBUTAR IA</span> · Diagnóstico tributario asistido · {new Date().getFullYear()}
          <br />
          <span translate="no">© {new Date().getFullYear()} · Desarrollado por <span className="font-semibold text-slate-500">TAKTO</span></span>
        </footer>
      </body>
    </html>
  );
}
