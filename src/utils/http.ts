import type express from "express";

export function sendJson(res: express.Response, status: number, data: object) {
	res.setHeader("Content-Type", "application/json");
	res.writeHead(status);
	res.end(JSON.stringify(data));
}
