FROM mcr.microsoft.com/playwright:v1.61.0-noble AS builder

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY tests ./tests
COPY tsconfig.json ./
RUN npm run build

WORKDIR /app/manager
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/index.html app/tsconfig*.json app/vite.config.ts app/vitest.config.ts ./
COPY app/src ./src
COPY app/tests ./tests
RUN npm test && npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

WORKDIR /app/manager
COPY app/package.json app/package-lock.json ./
COPY --from=builder /app/manager/node_modules ./node_modules
COPY --from=builder /app/manager/dist ./dist
RUN mkdir -p /app/manager/data/screenshots \
    && chown -R pwuser:pwuser /app/manager/data

USER pwuser
ENV NODE_ENV=production \
    CHECKIN_MODE=production \
    CHECKIN_MANAGER_HOST=0.0.0.0 \
    CHECKIN_MANAGER_PORT=8787
EXPOSE 8787
CMD ["node", "dist/server/index.js"]
