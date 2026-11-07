/** @type {import('next').NextConfig} */
// Cabeceras de seguridad para todas las respuestas.
//  · frame-ancestors / X-Frame-Options: nadie puede incrustar la web en otra
//    página (evita engaños de clic sobre botones de pago o de borrar).
//  · nosniff: el navegador no "adivina" tipos de archivo.
//  · Referrer-Policy: no filtra rutas internas a otros sitios.
//  · Permissions-Policy: sin cámara, micrófono ni ubicación.
const CABECERAS_SEGURIDAD = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: CABECERAS_SEGURIDAD }];
  },
  // Paquetes que deben quedar como externos del servidor (usan binarios/ESM
  // pesados): unpdf (pdf.js) para leer PDFs, y el navegador headless del buzón.
  // Next 15: paquetes externos del servidor (antes experimental.serverComponentsExternalPackages).
  // src/instrumentation.ts (planificador de la tarea nocturna) ya es estable: no
  // necesita la opción instrumentationHook.
  serverExternalPackages: ["unpdf", "tesseract.js", "exceljs", "fast-xml-parser", "playwright-core", "@sparticuz/chromium", "pg"],
};

module.exports = nextConfig;
