# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-bookworm-slim
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.61.0-noble

FROM ${NODE_IMAGE} AS dependency-manifests

WORKDIR /manifests
COPY scripts/normalize-docker-manifest.mjs /tools/normalize-docker-manifest.mjs
COPY package.json package-lock.json ./root/
COPY app/package.json app/package-lock.json ./manager/
RUN node /tools/normalize-docker-manifest.mjs /manifests/root \
    && node /tools/normalize-docker-manifest.mjs /manifests/manager

FROM ${NODE_IMAGE} AS build-base

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

FROM build-base AS root-deps

WORKDIR /app
COPY --from=dependency-manifests /manifests/root/package.json /manifests/root/package-lock.json ./
RUN --mount=type=cache,id=paopao-root-npm,target=/root/.npm,sharing=locked \
    npm ci

FROM root-deps AS root-prod-deps
RUN npm prune --omit=dev

FROM build-base AS manager-deps

WORKDIR /app/manager
COPY --from=dependency-manifests /manifests/manager/package.json /manifests/manager/package-lock.json ./
RUN --mount=type=cache,id=paopao-manager-npm,target=/root/.npm,sharing=locked \
    npm ci

FROM build-base AS builder

WORKDIR /app
COPY --from=root-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY tests ./tests
COPY tsconfig.json ./
RUN npm run build

WORKDIR /app/manager
COPY --from=manager-deps /app/manager/node_modules ./node_modules
COPY app/package.json app/package-lock.json ./
COPY app/index.html app/tsconfig*.json app/vite.config.ts app/vitest.config.ts ./
COPY app/public ./public
COPY app/src ./src
COPY app/tests ./tests
RUN npm test && npm run build && npm prune --omit=dev

FROM ${PLAYWRIGHT_IMAGE}

WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=root-prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

WORKDIR /app/manager
COPY app/package.json app/package-lock.json ./
COPY --from=builder /app/manager/node_modules ./node_modules
COPY --from=builder /app/manager/dist ./dist

# PLAYWRIGHT_IMAGE is a pinned, Chromium-only runtime prepared by the
# deployment workflow. It retains Playwright's verified Chromium dependencies.
RUN mkdir -p /app/manager/data/screenshots \
    && chown -R pwuser:pwuser /app/manager/data

USER pwuser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production \
    CHECKIN_MODE=production \
    CHECKIN_MANAGER_HOST=0.0.0.0 \
    CHECKIN_MANAGER_PORT=8787
EXPOSE 8787
CMD ["node", "dist/server/index.js"]
