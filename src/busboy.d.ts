declare module "busboy" {
	import type { Readable } from "stream";

	interface FileInfo {
		filename: string;
		encoding: string;
		mimeType: string;
	}

	interface BusboyConfig {
		headers: Record<string, string | string[] | undefined>;
	}

	interface Busboy {
		on(event: "file", listener: (name: string, file: Readable, info: FileInfo) => void): this;
		on(event: "close", listener: () => void): this;
		on(event: "error", listener: (err: Error) => void): this;
		pipe: (src: NodeJS.ReadableStream) => this;
	}

	function busboy(config: BusboyConfig): Busboy;
	export default busboy;
}
