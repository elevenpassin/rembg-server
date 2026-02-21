import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import z from "zod";
import { db } from "./db.ts";
import { publicProcedure, router } from "./trpc.ts";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";

const appRouter = router({
	userList: publicProcedure.query(async () => {
		const users = await db.user.findMany();
		return users;
	}),
	userById: publicProcedure.input(z.int()).query(async (opts) => {
		const { input } = opts;

		const user = await db.user.findUnique({
			where: {
				id: input,
			},
		});

		return user;
	}),
});

export type AppRouter = typeof appRouter;

const trpcHandler = createHTTPHandler({
	router: appRouter,
	basePath: "/trpc/",
});

const PUBLIC_DIR = path.join(process.cwd(), "public");
const MIME: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
};

function servePublic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
	if (req.method !== "GET" && req.method !== "HEAD") return false;
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
	let p = url.pathname;
	if (p === "/") p = "/index.html";
	const safePath = path.normalize(p).replace(/^\//, "");
	if (safePath.includes("..")) return false;
	const filePath = path.resolve(PUBLIC_DIR, safePath);
	const root = path.resolve(PUBLIC_DIR);
	if (filePath !== root && !filePath.startsWith(root + path.sep)) return false;
	try {
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) return false;
		const ext = path.extname(filePath);
		const contentType = MIME[ext] ?? "application/octet-stream";
		res.setHeader("Content-Type", contentType);
		res.setHeader("Content-Length", String(stat.size));
		if (req.method === "HEAD") {
			res.writeHead(200);
			res.end();
			return true;
		}
		fs.createReadStream(filePath).pipe(res);
		return true;
	} catch {
		return false;
	}
}

const server = http.createServer((req, res) => {
	if (servePublic(req, res)) return;
	trpcHandler(req, res);
});

server.listen(3000);
