FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.17.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/bot/package.json apps/bot/package.json

RUN pnpm install --no-frozen-lockfile

COPY apps/bot apps/bot

EXPOSE 4100
CMD ["pnpm","start:bot"]
