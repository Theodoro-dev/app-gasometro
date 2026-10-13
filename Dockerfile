# Gasometro - imagem da API + app (PWA)
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=America/Sao_Paulo

WORKDIR /app

# Dependencias primeiro (melhor cache)
COPY package*.json ./
RUN npm install --omit=dev --no-fund --no-audit

# Codigo da API e do app
COPY db ./db
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Usuario sem privilegio (a imagem node ja traz o usuario "node")
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/saude >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.js"]