# Imagen oficial de Playwright (trae Chromium + dependencias del sistema).
# La versión debe coincidir con la de playwright-core en package.json.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

# Evita que npm intente descargar navegadores (ya vienen en la imagen).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
