# Imagen para correr Radar Tributar·IA (Next.js + Playwright/Chromium) en
# cualquier host de contenedores: Railway, Fly.io o un VPS (Hetzner/Contabo/Oracle).
# Incluye las librerías del sistema que necesita el Chromium de @sparticuz/chromium
# (buzón, RTT, honorarios). Los datos van a DATA_DIR (monta un volumen ahí).
FROM node:22-bookworm-slim

# Dependencias del sistema para Chromium headless.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libasound2 libpangocairo-1.0-0 libpango-1.0-0 libcairo2 libatspi2.0-0 \
      libx11-6 libxcb1 libxext6 libxi6 libxtst6 libxss1 libglib2.0-0 \
      libgtk-3-0 libpangoft2-1.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala TODAS las dependencias (incluye dev, necesarias para 'next build').
COPY package*.json ./
RUN npm ci

# Copia el código y compila.
COPY . .
RUN npm run build

# Runtime.
ENV NODE_ENV=production
# Los navegadores headless usan varios listeners; sube el límite para evitar warnings.
ENV NODE_OPTIONS=--max-old-space-size=1536
# Persistencia: monta un volumen del host en /var/data (clientes, uploads, backups).
ENV DATA_DIR=/var/data
# Máx. navegadores simultáneos (protege la RAM). Ajusta según el plan del host.
ENV MAX_NAVEGADORES=2
# Puerto (los hosts inyectan PORT; Next 'start' lo respeta).
ENV PORT=3000
EXPOSE 3000

# Crea el volumen de datos por si el host no lo monta explícitamente.
VOLUME ["/var/data"]

CMD ["npm", "start"]
