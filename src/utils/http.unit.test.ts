import type express from "express";
import { describe, expect, it, vi } from "vitest";
import { sendJson } from "./http.ts";

describe("sendJson", () => {
	it("sets content type, status, and serialized body", () => {
		const setHeader = vi.fn();
		const writeHead = vi.fn();
		const end = vi.fn();
		const res = {
			setHeader,
			writeHead,
			end,
		} as unknown as express.Response;

		sendJson(res, 201, { ok: true });

		expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
		expect(writeHead).toHaveBeenCalledWith(201);
		expect(end).toHaveBeenCalledWith('{"ok":true}');
	});
});
