# Build context is the repo root (pnpm workspace), e.g.
#   docker build -f apps/viewer/Dockerfile .

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
# better-sqlite3 (a dependency of @llmviz/storage) compiles a native addon on install.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@llmviz/viewer..." build

FROM node:22-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app /app

ENV LLMVIZ_VIEWER_HOST=0.0.0.0
ENV LLMVIZ_VIEWER_API_PORT=8318
ENV LLMVIZ_DB=/data/llmviz.db
VOLUME ["/data"]
EXPOSE 5317

RUN chmod +x /app/apps/viewer/docker-entrypoint.sh
CMD ["/app/apps/viewer/docker-entrypoint.sh"]
