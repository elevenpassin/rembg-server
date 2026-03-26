# rembg-server

TypeScript + Express server that accepts image uploads, removes backgrounds through a `rembg` HTTP service, and returns PNG results as one `multipart/mixed` response.

The project also includes:
- a static browser test page in `public/`,
- a small tRPC API backed by PostgreSQL + Prisma,
- unit and e2e tests with Vitest + Supertest,
- containerized local deployment with Docker Compose + Caddy,
- Fly.io deployment config for production.

## What The Server Does

- Handles `POST /upload` with multipart image files.
- Enforces upload guardrails (max files, max size, allowed mime types).
- Sends each image to rembg (`REMBG_URL`) for background removal.
- Streams back one `multipart/mixed` response containing PNG attachments.
- Exposes health probes at `/health` and `/health/rembg`.
- Serves static files from `public/`.
- Exposes tRPC procedures at `/trpc`.

## Stack

- Runtime: Node.js (ESM) + TypeScript (`ts-node`)
- HTTP framework: Express 5
- Upload parsing: Busboy
- API/RPC: tRPC (`@trpc/server` with Express adapter)
- DB: Prisma + PostgreSQL (`pg`, `@prisma/adapter-pg`)
- Image processing service: `rembg` over HTTP
- Tests: Vitest + Supertest
- Local edge proxy/TLS: Caddy
- Production target: Fly.io

## Project Layout

- `src/index.ts` - Express app wiring, routes, upload pipeline, tRPC mount, static serving
- `src/trpc.ts` - tRPC initialization helpers
- `src/db.ts` - Prisma client + PG adapter
- `src/utils/files.ts` - output filename helper
- `src/utils/http.ts` - JSON response helper
- `src/utils/network.ts` - TCP reachability check helper
- `src/**/*.unit.test.ts` - unit tests
- `src/**/*.e2e.test.ts` - API/e2e tests
- `prisma/schema.prisma` - `User` / `Bookmark` models
- `public/` - static browser smoke/load test UI
- `compose.yml` - local Caddy + app + rembg stack
- `Dockerfile` - multi-stage local/prod images
- `fly.toml` - Fly app config

## Server Behavior

## `POST /upload`

Request requirements:
- `Content-Type: multipart/form-data`
- At least one image file (field name is flexible; current UI sends `images`)

Limits and validation:
- Max file count: `7`
- Max size: `10 MB` per file
- Allowed mime types:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - `image/gif`
  - `image/svg+xml`
  - `image/x-icon`
  - `image/bmp`

Response:
- `200 OK`
- `Content-Type: multipart/mixed; boundary=...`
- One part per processed image:
  - `Content-Type: image/png`
  - `Content-Disposition: attachment; filename="<base>-nobg.png"`

Error behavior:
- `400` for bad upload requests (wrong content type, too large, bad mime, empty input)
- `502` if rembg fails before multipart response starts

Implementation notes:
- Uploads are parsed with Busboy and buffered per file.
- Files are processed sequentially against rembg.
- If a rembg failure happens after multipart streaming starts, the error is logged and processing continues best-effort.

## `GET /health`

- Always returns `200 {"status":"ok"}` when app process is serving traffic.

## `GET /health/rembg`

- Parses host/port from `REMBG_URL`.
- Attempts one TCP connect with 5s timeout.
- Returns:
  - `200 {"status":"ok"}` when rembg is reachable
  - `503 {"status":"unavailable","service":"rembg"}` when unreachable

## tRPC Endpoints

Mounted at `/trpc` via Express middleware.

Current procedures:
- `userList` - list all users
- `userById` - fetch a user by integer ID

## Static Assets

`express.static` serves files from `public/` (for example `/`, `/script.js`, `/styles.css`).

## Database

Prisma models:
- `User` (`id`, `email`, optional `name`, relation to `Bookmark`)
- `Bookmark` (`id`, `link`, optional `userId`)

Client generation:
- Prisma client output path: `src/generated/prisma`

Runtime DB bootstrap:
- `src/db.ts` builds a `pg` pool from `DATABASE_URL`
- Prisma uses `PrismaPg` adapter

## Environment Variables

- `DATABASE_URL` (required for Prisma/Postgres access)
- `REMBG_URL` (optional; default `http://localhost:7000`)

See `.env.example` for template values and notes.

## Local Development (No Docker)

Prerequisites:
- Node.js + pnpm
- PostgreSQL instance reachable by `DATABASE_URL`
- rembg HTTP service reachable by `REMBG_URL` (default `http://localhost:7000`)

Setup:

```bash
pnpm install
cp .env.example .env
pnpm run prisma:generate
```

Run:

```bash
pnpm run serve
```

Quick checks:

```bash
curl -s http://localhost:3000/health
curl -s http://localhost:3000/health/rembg
```

## Testing

Available scripts:

```bash
pnpm run test          # unit + e2e
pnpm run test:unit     # src/**/*.unit.test.ts
pnpm run test:e2e      # src/**/*.e2e.test.ts
pnpm run test:watch    # Vitest watch mode
pnpm run typecheck
pnpm run typecheck:test
```

Current coverage in repo includes:
- utility unit tests for files/http/network helpers
- e2e checks for health and 404 responses

## Docker Compose (Local Deployment)

`compose.yml` starts:
- `proxy` (Caddy) on `80/443`
- `app` (this server) on `3000`
- `rembg` (`danielgatis/rembg:latest`) on internal `7000`

Caddy routes:
- `/trpc/*`, `/upload`, `/health`, `/health/rembg` -> `app:3000`
- all other paths -> static files from `/srv` (`./public` mount)

Run:

```bash
docker compose up --build
```

Stop:

```bash
docker compose down
```

Compose-specific behavior:
- app gets `REMBG_URL=http://rembg:7000`
- app startup is gated on rembg health

## Dockerfile Targets

- `runner` (local app target)
  - based on Node Alpine build stage
  - runs only Node server (`pnpm run serve`)

- `runner-prod` (Fly target)
  - Debian slim + Python + `rembg[cpu,cli]`
  - pre-downloads rembg model (`rembg d`)
  - starts both:
    - `rembg s --host 0.0.0.0 --port 7000`
    - Node app (`pnpm run serve`)
  - exposes ports `3000` and `7000`

## Fly.io Deployment

`fly.toml` uses:
- Docker build target: `runner-prod`
- app port: `3000`
- `REMBG_URL=http://localhost:7000`
- request concurrency limits: soft `20`, hard `25`
- VM memory: `1gb` / `1024 MB`

Health checks configured:
- HTTP check on `/health`
- TCP check on port `7000` (rembg)

Typical deploy flow:

```bash
fly auth login
fly secrets set DATABASE_URL="postgres://..."
fly deploy
```

Post-deploy validation:

```bash
fly status
fly logs
curl -s https://<your-app>.fly.dev/health
curl -s https://<your-app>.fly.dev/health/rembg
```

## Browser Test UI

`public/index.html` and `public/script.js` provide a quick manual harness to:
- upload up to 7 images,
- call `/upload`,
- parse multipart response client-side,
- preview + download generated PNGs,
- call `/trpc/userList`.

## Operational Notes

- Uploads are buffered in memory before rembg calls; memory usage scales with file size and concurrency.
- rembg model warm-up can be slow on cold boot; container and Fly checks are configured with startup grace periods.
- `/health` indicates app liveness; `/health/rembg` indicates dependency readiness.

## Useful Commands

```bash
pnpm run serve
pnpm run prisma:generate
pnpm run prisma:studio
pnpm run check
pnpm run typecheck
pnpm run test
```

