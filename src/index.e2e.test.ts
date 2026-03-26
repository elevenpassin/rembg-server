import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./index.ts";

describe("health endpoints", () => {
	it("returns ok for /health", async () => {
		const response = await request(app).get("/health");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ status: "ok" });
	});

	it("returns 404 for unknown route", async () => {
		const response = await request(app).get("/does-not-exist");

		expect(response.status).toBe(404);
	});
});
