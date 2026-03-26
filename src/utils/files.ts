import path from "node:path";

export function outputFilename(name: string): string {
	const base = path.basename(name, path.extname(name));
	return `${base}-nobg.png`;
}
