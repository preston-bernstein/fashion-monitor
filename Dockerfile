FROM node:24-bookworm AS base
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.5.4 prune @fm/cli --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json
RUN node -e "const fs=require('fs'),t=JSON.parse(fs.readFileSync('turbo.json'));delete t.tasks['@fm/api#build'];fs.writeFileSync('turbo.json',JSON.stringify(t,null,2));"
RUN pnpm turbo run build --filter=@fm/cli

# Playwright browsers for Poshmark / Depop fallback
RUN pnpm exec playwright install --with-deps chromium

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /data
VOLUME ["/data"]
