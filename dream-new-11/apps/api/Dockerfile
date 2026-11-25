# syntax=docker/dockerfile:1.7
# Dream New 11 API. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t dream11-api .

ARG NODE_VERSION=22-alpine

# ── deps: install only the API + shared workspaces (lockfile-exact) ─────────
FROM node:${NODE_VERSION} AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/root/.npm npm ci -w @dream11/shared -w @dream11/api --ignore-scripts

# ── build: shared → Prisma client → Nest ────────────────────────────────────
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @dream11/shared \
 && npx -w @dream11/api prisma generate \
 && npm run build -w @dream11/api

# One-off job image: `prisma migrate deploy` (and optional demo seed) need the dev tooling.
FROM build AS migrate
WORKDIR /app/apps/api
CMD ["npx", "prisma", "migrate", "deploy"]

# ── prod-deps: runtime dependencies only ────────────────────────────────────
FROM node:${NODE_VERSION} AS prod-deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/root/.npm npm ci -w @dream11/shared -w @dream11/api --omit=dev --ignore-scripts
# The generated Prisma client (query engine for this platform) comes from the build stage.
COPY --from=build /app/node_modules/.prisma node_modules/.prisma

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma apps/api/prisma
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:4000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
