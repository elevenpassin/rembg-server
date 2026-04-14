import path from "node:path";
import { fileURLToPath } from "node:url";
import busboy from "busboy";
import { spawn } from "node:child_process";
import express from "express";
import { outputFilename } from "./utils/files.ts";
import { sendJson } from "./utils/http.ts";
import { connectOnce } from "./utils/network.ts";

const MAX_UPLOAD_IMAGES = 7;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const REMBG_URL = process.env.REMBG_URL ?? "http://localhost:7000";
const BOOTSTRAP_REMBG = process.env.BOOTSTRAP_REMBG === "1";
const BOOTSTRAP_REMBG_MODEL = process.env.REMBG_MODEL ?? "u2net";
const BOOTSTRAP_REMBG_WAIT_MS = Number.parseInt(process.env.REMBG_BOOTSTRAP_WAIT_MS ?? "", 10) || 120_000;
const BOOTSTRAP_REQUEST_WAIT_MS = Number.parseInt(process.env.REMBG_REQUEST_WAIT_MS ?? "", 10) || 120_000;
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

function parseRembgHostPort(rembgUrl: string): { host: string; port: number } {
	const u = new URL(rembgUrl);
	// Avoid IPv6 localhost edge cases by forcing loopback v4.
	const host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
	const port = Number(u.port) || 7000;
	return { host, port };
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRembg(host: string, port: number): Promise<void> {
	const deadline = Date.now() + BOOTSTRAP_REMBG_WAIT_MS;
	let lastErr: unknown = null;
	while (Date.now() < deadline) {
		try {
			await connectOnce(host, port);
			return;
		} catch (err) {
			lastErr = err;
			await delay(1000);
		}
	}
	const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
	throw new Error(`Timed out waiting for rembg at ${host}:${port}. Last error: ${msg}`);
}

function runRembgOnce(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn("rembg", args, {
			stdio: "inherit",
		});
		proc.on("error", reject);
		proc.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`rembg ${args.join(" ")} exited with code ${code}`));
		});
	});
}

async function maybeBootstrapRembg(): Promise<void> {
	const { host, port } = parseRembgHostPort(REMBG_URL);

	// Fast path: rembg is already reachable.
	try {
		await connectOnce(host, port);
		return;
	} catch (err) {
		// fall through to bootstrap logic
		if (!BOOTSTRAP_REMBG) {
			console.warn(
				`[startup] rembg not reachable at ${host}:${port} and BOOTSTRAP_REMBG != 1; continuing anyway.`,
			);
			return;
		}
		console.warn(`[startup] rembg not reachable; bootstrapping (this may take a while)...`, err);
	}

	await runRembgOnce(["d", BOOTSTRAP_REMBG_MODEL]);

	const rembgServer = spawn(
		"rembg",
		["s", "--host", "0.0.0.0", "--port", String(port)],
		{
			stdio: "inherit",
		},
	);

	// If rembg exits immediately, fail fast so Fly marks the machine unhealthy.
	rembgServer.on("exit", (code) => {
		if (code !== 0) console.error(`[startup] rembg server exited with code ${code}`);
	});

	await waitForRembg(host, port);
	console.log(`[startup] rembg is reachable at ${host}:${port}`);
}

let rembgReadyPromise: Promise<void> | null = null;

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

		// Avoid streaming an "empty" multipart response when rembg isn't ready.
		const { host, port } = parseRembgHostPort(REMBG_URL);
		if (BOOTSTRAP_REMBG && rembgReadyPromise) {
			// If we're currently bootstrapping rembg, wait up to a bounded amount.
			await Promise.race([
				rembgReadyPromise,
				delay(BOOTSTRAP_REQUEST_WAIT_MS).then(() => undefined),
			]).catch(() => undefined);
		}
		try {
			await connectOnce(host, port);
		} catch {
			sendJson(res, 503, { error: "rembg unavailable" });
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
	(async () => {
		// Per requirement: only start Express after rembg is actually reachable.
		if (BOOTSTRAP_REMBG) {
			rembgReadyPromise = maybeBootstrapRembg();
			await rembgReadyPromise;
		} else {
			const { host, port } = parseRembgHostPort(REMBG_URL);
			await waitForRembg(host, port);
		}

		app.listen(PORT, "0.0.0.0");
	})().catch((err) => {
		console.error("[startup] failed to start app (rembg not ready)", err);
		process.exit(1);
	});
}
