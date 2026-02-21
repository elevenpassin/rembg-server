FROM node:25-alpine AS base
RUN apk add --no-cache bash wget

WORKDIR /app



COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY src ./src
COPY prisma ./prisma

RUN pnpm run prisma:generate

# Prod (Fly Proxy + App)
FROM base AS runner-prod
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/src ./src
COPY --from=base /app/prisma ./prisma
COPY public ./public
EXPOSE 3000
CMD ["pnpm", "run", "serve"]

# Local (Caddy + App)
FROM base AS runner
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/src ./src
COPY --from=base /app/prisma ./prisma
EXPOSE 3000
CMD ["pnpm", "run", "serve"]