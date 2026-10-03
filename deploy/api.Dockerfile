FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.17.1 --activate

COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/rules/package.json packages/rules/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --no-frozen-lockfile

COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/rules packages/rules
COPY packages/shared packages/shared

RUN pnpm --filter @dotacjapro/db db:generate

EXPOSE 4000
CMD ["pnpm","start:api"]
