FROM node:25-alpine AS base
RUN apk add --no-cache bash wget

WORKDIR /app



COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY src ./src
COPY prisma ./prisma

RUN pnpm run prisma:generate

# Prod (Fly Proxy + App): Node app + rembg HTTP server in one container
# Use Debian slim (glibc) so pip gets prebuilt wheels for onnxruntime/opencv (Alpine/musl has none)
FROM node:25-bookworm-slim AS runner-prod
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
	&& rm -rf /var/lib/apt/lists/* \
	&& pip3 install --break-system-packages "rembg[cpu,cli]"
RUN npm install -g pnpm

WORKDIR /app
COPY --from=base /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
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