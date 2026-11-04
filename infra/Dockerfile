# syntax=docker/dockerfile:1.7
# Imagen única para app1…app8 (cambia solo INSTANCE_ID). Contexto: raíz del repo.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# --- Manifiestos (capa cacheable) ---
FROM base AS manifiestos
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# --- Dependencias completas para compilar ---
FROM manifiestos AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- Build de Next ---
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @preconteo/web build

# --- Solo dependencias de producción ---
FROM manifiestos AS deps-prod
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

# --- Imagen final ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
WORKDIR /repo
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps-prod /repo/node_modules ./node_modules
COPY --from=deps-prod /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps-prod /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY packages/shared ./packages/shared
COPY apps/web/package.json apps/web/next.config.mjs apps/web/server.js ./apps/web/
COPY apps/web/src ./apps/web/src
COPY --from=build /repo/apps/web/.next ./apps/web/.next

USER app
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["node", "server.js"]
