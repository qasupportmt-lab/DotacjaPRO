FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/miniapp/package.json apps/miniapp/package.json
RUN pnpm install --no-frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY apps/miniapp apps/miniapp
RUN pnpm --filter @dotacjapro/miniapp build

FROM node:22-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/turbo.json ./
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/miniapp /app/apps/miniapp
EXPOSE 3000
CMD ["sh","-c","cd apps/miniapp && pnpm exec next start -p ${PORT:-3000}"]
