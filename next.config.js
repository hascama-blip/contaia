/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // tesseract.js usa workers/node-fetch; lo dejamos como paquete externo del servidor
  experimental: {
    serverComponentsExternalPackages: ["tesseract.js", "playwright-core"],
  },
};

module.exports = nextConfig;
