import type { Metadata } from "next";
import { headers } from "next/headers";
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
  // Sitio público de la Asociación Mutualista: se renderiza SIN el chrome de
  // Radar (sin header/menú/footer), como un sitio independiente.
  const pathname = headers().get("x-pathname") || "";
  // Páginas INDEPENDIENTES a pantalla completa (sin header/menú/footer de Radar):
  // el sitio público de la Mutualista y el dashboard ISSOSOMA (este sí requiere
  // sesión, que impone el middleware; solo se omite el chrome).
  if (pathname.startsWith("/asociacionmutualista") || pathname.startsWith("/issosoma")) {
    return (
      <html lang="es">
        <body>{children}</body>
      </html>
    );
  }

  await ensureSupremo().catch(() => {});
  await ensureRtpUser().catch(() => {});
  const user = await getCurrentUser();
  const admin = esAdmin(user);
  const supremo = esSupremo(user);
  const soloRtp = esSoloRtp(user);
  // Páginas de autenticación: NUNCA muestran el header/menú ni el modal de
  // planes, aunque quede una sesión previa (p. ej. al salir y volver al login).
  const esAuthPage = pathname.startsWith("/login") || pathname.startsWith("/reset");
  // Plan del estudio (los operadores heredan el de su admin). El supremo se
  // trata como el plan máximo. Decide el menú "Equipo", el link de planes y
  // si se muestra la ventana de planes (SOLO en el plan gratis = básico).
  const plan = user && !soloRtp ? (supremo ? "equipo" : await planDelEstudio(user)) : undefined;
  const equipo = plan === "equipo";
  const mostrarHeader = !!user && !esAuthPage;
  return (
    <html lang="es">
      <body>
        {mostrarHeader && (
          <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-3 py-2.5 sm:px-4 sm:py-3 lg:gap-10">
              <Link href={soloRtp ? "/rtputilitarios" : "/"} className="mr-2 flex shrink-0 items-center lg:mr-6" translate="no">
                <LogoAsenco />
              </Link>
              {soloRtp ? (
                // Header MÍNIMO para el usuario restringido: solo su hub, sus
                // empresas (para el acceso SOL de honorarios) y salir.
                <div className="flex items-center gap-1.5 text-sm sm:gap-3">
                  <Link href="/rtputilitarios" className="rounded-lg px-2.5 py-2 hover:bg-slate-100 sm:px-3">Utilitarios RTP</Link>
                  <Link href="/clientes" className="rounded-lg px-2.5 py-2 hover:bg-slate-100 sm:px-3">Empresas</Link>
                  <SalirBtn />
                </div>
              ) : (
                <HeaderNav
                  nombre={user!.nombre + (admin ? "" : " · operador")}
                  admin={admin}
                  supremo={supremo}
                  equipo={equipo}
                  plan={plan}
                />
              )}
            </div>
          </header>
        )}
        {/* Ventana de planes: solo en el plan GRATIS (básico); nunca si ya se
            asignó un plan (regular/premium/equipo), ni al supremo, ni en login. */}
        {mostrarHeader && !soloRtp && plan === "basico" && <PlanesModal />}
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
