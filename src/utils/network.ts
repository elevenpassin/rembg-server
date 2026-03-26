import net from "node:net";

const CONNECT_TIMEOUT_MS = 5_000; // for /health/rembg so we don't hang

export function connectOnce(host: string, port: number): Promise<void> {
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
