FROM node:22-alpine AS base
RUN apk add --no-cache bash wget

WORKDIR /app



COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY src ./src
COPY prisma ./prisma

RUN pnpm run prisma:generate


FROM node:22-bookworm-slim AS runner-base
# Use Debian slim (glibc) so pip gets prebuilt wheels for onnxruntime/opencv (Alpine/musl has none)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip \
	&& rm -rf /var/lib/apt/lists/* \
	&& pip3 install --no-cache-dir --break-system-packages "rembg[cpu,cli]"
RUN npm install -g pnpm

# Prod (Fly Proxy + App): Node app + rembg HTTP server in one container
FROM runner-base AS runner-prod

WORKDIR /app
COPY --from=base /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/src ./src
COPY --from=base /app/prisma ./prisma
COPY public ./public

ENV REMBG_URL=http://localhost:7000
EXPOSE 3000 7000
CMD ["pnpm", "run", "serve"]

# Local (Caddy + App)
FROM base AS runner
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/src ./src
COPY --from=base /app/prisma ./prisma
EXPOSE 3000
CMD ["pnpm", "run", "serve"]