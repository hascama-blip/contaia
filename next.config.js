/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Paquetes que deben quedar como externos del servidor (usan binarios/ESM
  // pesados): unpdf (pdf.js) para leer PDFs, y el navegador headless del buzón.
  experimental: {
    serverComponentsExternalPackages: ["unpdf", "playwright-core", "@sparticuz/chromium"],
  },
};

module.exports = nextConfig;
