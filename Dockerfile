# Imagen para producción (Coolify u otro servidor con Docker).
# La base de datos es PostgreSQL y se conecta con DATABASE_URL (en Coolify: un recurso PostgreSQL aparte).
FROM node:24-alpine

ENV NODE_ENV=production \
    PUERTO=3000
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

# data/ guarda los Excel pendientes y las imágenes subidas (la base de datos está en PostgreSQL): montala en un
# volumen persistente en /app/data. Se crea acá con dueño "node" para que el volumen nuevo herede el permiso.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PUERTO}/salud" || exit 1

CMD ["node", "src/servidor.js"]
