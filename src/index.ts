import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import z from "zod";
import busboy from "busboy";
import { db } from "./db.ts";
import { publicProcedure, router } from "./trpc.ts";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";

const MAX_UPLOAD_IMAGES = 7;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const REMBG_URL = process.env.REMBG_URL ?? "http://localhost:7000";

const ALLOWED_IMAGE_MIMES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/svg+xml",
	"image/x-icon",
	"image/bmp",
]);

function sendJson(res: http.ServerResponse, status: number, data: object) {
	res.setHeader("Content-Type", "application/json");
	res.writeHead(status);
	res.end(JSON.stringify(data));
}

function outputFilename(name: string): string {
	const base = path.basename(name, path.extname(name));
	return `${base}-nobg.png`;
}

async function removeBackground(buffer: Buffer, filename: string): Promise<Buffer> {
	const form = new FormData();
	form.append("file", new Blob([new Uint8Array(buffer)]), filename);
	const res = await fetch(`${REMBG_URL}/api/remove`, {
		method: "POST",
		body: form,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`rembg: ${res.status} ${text.slice(0, 200)}`);
	}
	const arrayBuffer = await res.arrayBuffer();
	return Buffer.from(arrayBuffer);
}

function handleUpload(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): void {
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
	if (req.method !== "POST" || url.pathname !== "/upload") return;

	const contentType = req.headers["content-type"];
	if (!contentType?.startsWith("multipart/form-data")) {
		sendJson(res, 400, { error: "Content-Type must be multipart/form-data" });
		return;
	}

	const files: { filename: string; buffer: Buffer; mimeType: string }[] = [];
	let error: string | null = null;

	const bb = busboy({ headers: req.headers });

	bb.on("file", (name, file, info) => {
		const { filename, mimeType } = info;
		const chunks: Buffer[] = [];
		let size = 0;
		file.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_FILE_SIZE) {
				error ??= `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB per file)`;
				return;
			}
			chunks.push(chunk);
		});
		file.on("end", () => {
			if (error) return;
			if (files.length >= MAX_UPLOAD_IMAGES) {
				error ??= `Maximum ${MAX_UPLOAD_IMAGES} images allowed`;
				return;
			}
			const mime = (mimeType || "application/octet-stream").split(";")[0].trim();
			if (!ALLOWED_IMAGE_MIMES.has(mime)) {
				error ??= `Invalid file type: ${mime}. Allowed: images only`;
				return;
			}
			files.push({
				filename: filename || "unknown",
				buffer: Buffer.concat(chunks),
				mimeType: mime,
			});
		});
		file.resume();
	});

	bb.on("close", async () => {
		if (error) {
			sendJson(res, 400, { error });
			return;
		}
		if (files.length === 0) {
			sendJson(res, 400, { error: "No image files uploaded" });
			return;
		}

		const boundary = `----rembg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		res.writeHead(200, {
			"Content-Type": `multipart/mixed; boundary=${boundary}`,
		});

		for (const file of files) {
			try {
				const outBuffer = await removeBackground(file.buffer, file.filename);
				const outName = outputFilename(file.filename);
				const part = [
					`--${boundary}`,
					"Content-Type: image/png",
					`Content-Disposition: attachment; filename="${outName}"`,
					"",
					"",
				].join("\r\n");
				res.write(part, "utf8");
				res.write(outBuffer);
				res.write("\r\n", "utf8");
			} catch (err) {
				if (!res.headersSent) {
					sendJson(res, 502, {
						error: err instanceof Error ? err.message : "rembg failed",
					});
					return;
				}
				console.error("rembg error for", file.filename, err);
			}
		}

		res.write(`--${boundary}--\r\n`, "utf8");
		res.end();
	});

	bb.on("error", (err) => {
		sendJson(res, 400, { error: err.message });
	});

	req.pipe(bb as unknown as NodeJS.WritableStream);
}

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
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
	const pathname = url.pathname.replace(/\/$/, "") || "/";
	if (req.method === "POST" && pathname === "/upload") {
		handleUpload(req, res);
		return;
	}
	if (req.method === "GET" && pathname === "/health") {
		sendJson(res, 200, { status: "ok" });
		return;
	}
	if (req.method === "GET" && pathname === "/health/rembg") {
		const rembgUrl = new URL(REMBG_URL);
		const host = rembgUrl.hostname;
		const port = Number(rembgUrl.port) || 7000;
		connectOnce(host, port)
			.then(() => sendJson(res, 200, { status: "ok" }))
			.catch(() => sendJson(res, 503, { status: "unavailable", service: "rembg" }));
		return;
	}
	if (servePublic(req, res)) return;
	if (pathname.startsWith("/trpc/")) {
		trpcHandler(req, res);
		return;
	}
	res.writeHead(404);
	res.end();
});

const CONNECT_TIMEOUT_MS = 5_000; // for /health/rembg so we don't hang

function connectOnce(host: string, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(
			{ host, port, timeout: CONNECT_TIMEOUT_MS },
			() => {
				socket.destroy();
				resolve();
			},
		);
		socket.on("error", (err) => {
			socket.destroy();
			reject(err);
		});
		socket.on("timeout", () => {
			socket.destroy();
			reject(new Error("Connection timeout"));
		});
	});
}

server.listen(3000, "0.0.0.0");
