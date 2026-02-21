FROM node:25-alpine AS base
RUN apk add --no-cache bash wget

WORKDIR /app



COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY src ./src
COPY prisma ./prisma

RUN pnpm run prisma:generate

# Prod (Fly Proxy + App): Node app + rembg HTTP server in one container
FROM base AS runner-prod
# Install Python and rembg (CPU + CLI for HTTP server)
RUN apk add --no-cache python3 py3-pip \
	&& pip3 install --break-system-packages "rembg[cpu,cli]"

WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/src ./src
COPY --from=base /app/prisma ./prisma
COPY public ./public

ENV REMBG_URL=http://localhost:7000
EXPOSE 3000
CMD ["sh", "-c", "rembg s --host 0.0.0.0 --port 7000 & exec pnpm run serve"]

# Local (Caddy + App)
FROM base AS runner
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/src ./src
COPY --from=base /app/prisma ./prisma
EXPOSE 3000
CMD ["pnpm", "run", "serve"]