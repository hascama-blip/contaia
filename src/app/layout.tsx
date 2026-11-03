import type { Metadata } from "next";
import { headers } from "next/headers";
import AppShell from "@/components/AppShell";
import PlanesModal from "@/components/PlanesModal";
import { SupremoProvider } from "@/components/SupremoContext";
import { getCurrentUser, esAdmin, esSupremo, esSoloRtp, ensureSupremo, ensureRtpUser, planDelEstudio } from "@/lib/auth";
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
  const contenido = <SupremoProvider value={supremo}>{children}</SupremoProvider>;
  return (
    <html lang="es">
      <body>
        {/* Ventana de planes: solo en el plan GRATIS (básico); nunca si ya se
            asignó un plan (regular/premium/equipo), ni al supremo, ni en login. */}
        {mostrarHeader && !soloRtp && plan === "basico" && <PlanesModal />}
        {mostrarHeader ? (
          // Con sesión: barra lateral + barra superior (el usuario "solo RTP"
          // ve una navegación mínima: su hub, sus empresas y salir).
          <AppShell
            nombre={user!.nombre + (admin ? "" : " · operador")}
            admin={admin}
            supremo={supremo}
            equipo={equipo}
            soloRtp={soloRtp}
            plan={plan}
          >
            {contenido}
          </AppShell>
        ) : (
          // Sin sesión (landing, login, reset): sin barras, página limpia.
          <>
            <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-6">{contenido}</main>
            <footer className="no-print mx-auto max-w-6xl px-4 py-8 text-center text-xs text-slate-400">
              <span translate="no">RADAR TRIBUTAR IA</span> · Diagnóstico tributario asistido · {new Date().getFullYear()}
              <br />
              <span translate="no">© {new Date().getFullYear()} · Desarrollado por <span className="font-semibold text-slate-500">TAKTO</span></span>
            </footer>
          </>
        )}
      </body>
    </html>
  );
}
