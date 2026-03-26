import { describe, expect, it } from "vitest";
import { outputFilename } from "./index.ts";

describe("outputFilename", () => {
	it("appends -nobg.png to the original basename", () => {
		expect(outputFilename("photo.jpeg")).toBe("photo-nobg.png");
		expect(outputFilename("avatar.profile.png")).toBe("avatar.profile-nobg.png");
	});
});
