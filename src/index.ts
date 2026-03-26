import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import busboy from "busboy";
import express from "express";
import z from "zod";
import { db } from "./db.ts";
import { publicProcedure, router } from "./trpc.ts";
import { outputFilename } from "./utils/files.ts";
import { sendJson } from "./utils/http.ts";
import { connectOnce } from "./utils/network.ts";

const MAX_UPLOAD_IMAGES = 7;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const REMBG_URL = process.env.REMBG_URL ?? "http://localhost:7000";
const DEFAULT_PORT = 3000;
const PORT = Number.parseInt(process.env.PORT ?? "", 10) || DEFAULT_PORT;

const ALLOWED_IMAGE_MIMES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/svg+xml",
	"image/x-icon",
	"image/bmp",
]);

async function removeBackground(
	buffer: Buffer,
	filename: string,
): Promise<Buffer> {
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

function handleUpload(req: express.Request, res: express.Response): void {
	const contentType = req.headers["content-type"];
	if (!contentType?.startsWith("multipart/form-data")) {
		sendJson(res, 400, { error: "Content-Type must be multipart/form-data" });
		return;
	}

	const files: { filename: string; buffer: Buffer; mimeType: string }[] = [];
	let error: string | null = null;

	const bb = busboy({ headers: req.headers });

	bb.on("file", (_name, file, info) => {
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
			const mime = (mimeType || "application/octet-stream")
				.split(";")[0]
				.trim();
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

export function createApp(): express.Express {
	const app = express();

	app.post("/upload", handleUpload);

	app.get("/health", (_req, res) => {
		sendJson(res, 200, { status: "ok" });
	});

	app.get("/health/rembg", async (_req, res) => {
		const rembgUrl = new URL(REMBG_URL);
		const host = rembgUrl.hostname;
		const port = Number(rembgUrl.port) || 7000;
		try {
			await connectOnce(host, port);
			sendJson(res, 200, { status: "ok" });
		} catch {
			sendJson(res, 503, { status: "unavailable", service: "rembg" });
		}
	});

	app.use(
		"/trpc",
		createExpressMiddleware({
			router: appRouter,
		}),
	);

	app.use(express.static(path.join(process.cwd(), "public")));

	app.use((_req, res) => {
		res.sendStatus(404);
	});

	return app;
}

export const app = createApp();

const isMainModule =
	process.argv[1] !== undefined &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
	app.listen(PORT, "0.0.0.0");
}
