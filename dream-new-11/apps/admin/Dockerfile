# syntax=docker/dockerfile:1.7
# Dream New 11 admin panel (static build served by nginx). Build from the repository root:
#   docker build -f apps/admin/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t dream11-admin .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN --mount=type=cache,target=/root/.npm npm ci -w @dream11/shared -w @dream11/admin --ignore-scripts
COPY packages/shared packages/shared
COPY apps/admin apps/admin
# Vite bakes the API URL into the bundle at build time.
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build -w @dream11/admin

FROM nginx:1.27-alpine AS runtime
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
