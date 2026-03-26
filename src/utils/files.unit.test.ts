import { describe, expect, it } from "vitest";
import { outputFilename } from "./files.ts";

describe("outputFilename", () => {
	it("returns png output name with -nobg suffix", () => {
		expect(outputFilename("avatar.jpg")).toBe("avatar-nobg.png");
		expect(outputFilename("profile.picture.webp")).toBe(
			"profile.picture-nobg.png",
		);
	});
});
