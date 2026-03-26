import net from "node:net";
import { describe, expect, it } from "vitest";
import { connectOnce } from "./network.ts";

async function withServer<T>(run: (port: number) => Promise<T>): Promise<T> {
	const server = net.createServer();
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Failed to bind test server");
	}

	try {
		return await run(address.port);
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => {
				if (err) {
					reject(err);
					return;
				}
				resolve();
			});
		});
	}
}

async function getUnusedPort(): Promise<number> {
	const server = net.createServer();
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Failed to allocate test port");
	}
	const port = address.port;
	await new Promise<void>((resolve, reject) => {
		server.close((err) => {
			if (err) {
				reject(err);
				return;
			}
			resolve();
		});
	});
	return port;
}

describe("connectOnce", () => {
	it("resolves when a TCP service is reachable", async () => {
		await withServer(async (port) => {
			await expect(connectOnce("127.0.0.1", port)).resolves.toBeUndefined();
		});
	});

	it("rejects when no service is listening", async () => {
		const port = await getUnusedPort();
		await expect(connectOnce("127.0.0.1", port)).rejects.toBeInstanceOf(Error);
	});
});
