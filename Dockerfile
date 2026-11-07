# Imagen de Radar Tributar·IA (Next.js + Chromium headless para SUNAT).
# Dos etapas: se compila con todas las dependencias y la imagen final lleva solo
# las de producción. La app corre con el usuario sin privilegios "node"; el
# script de arranque solo usa root para entregarle la carpeta de datos.

# ---- Base: librerías del sistema que necesita Chromium ----
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libasound2 libpangocairo-1.0-0 libpango-1.0-0 libcairo2 libatspi2.0-0 \
      libx11-6 libxcb1 libxext6 libxi6 libxtst6 libxss1 libglib2.0-0 \
      libgtk-3-0 libpangoft2-1.0-0 \
 && rm -rf /var/lib/apt/lists/*

# ---- Compilación (con dependencias de desarrollo) ----
FROM base AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev

# ---- Imagen final (solo producción) ----
FROM base AS runtime
ENV NODE_ENV=production
# Los navegadores headless usan varios listeners; sube el límite para evitar warnings.
ENV NODE_OPTIONS=--max-old-space-size=1536
# Persistencia: monta un volumen del host en /var/data (clientes, uploads, backups).
ENV DATA_DIR=/var/data
# Máx. navegadores simultáneos (protege la RAM). docker-compose lo sobreescribe.
ENV MAX_NAVEGADORES=2
ENV PORT=3000
WORKDIR /app
RUN chown node:node /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/next.config.js ./
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY deploy/entrypoint.sh /usr/local/bin/radar-entrypoint
RUN chmod 0755 /usr/local/bin/radar-entrypoint
EXPOSE 3000
ENTRYPOINT ["radar-entrypoint"]
CMD ["npm", "start"]
