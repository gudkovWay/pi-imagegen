import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildRequest } from "./image-request";

test("image requests use their dispatcher model, never a coding-agent model", async () => {
	const params = { prompt: "a red cube", model: "gpt-6.1-sol", provider: "openai-codex" };
	const body = await buildRequest(params, "session-one");
	expect(body.model).toBe("gpt-5.5");
	expect(body.tools[0].model).toBe("gpt-image-2");
	expect(body.prompt_cache_key).toBe("session-one");
	expect(body.input[0].content).toEqual([{ type: "input_text", text: "Generate this image: a red cube" }]);
});

test("reference bytes and explicit image controls survive dispatcher selection", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "image-request-"));
	try {
		const reference = path.join(root, "reference.jpg");
		await fs.writeFile(reference, new Uint8Array([1, 2, 3]));
		const body = await buildRequest({ prompt: "use this shape", referencePaths: [reference],
			size: "1536x1024", quality: "high", background: "opaque", outputFormat: "webp", thinking: "off" }, "session-two");
		expect(body.tools[0]).toMatchObject({ model: "gpt-image-2", size: "1536x1024",
			quality: "high", background: "opaque", output_format: "webp" });
		expect(body.input[0].content[1]).toEqual({ type: "input_image", image_url: "data:image/jpeg;base64,AQID" });
		expect(body.reasoning).toBeUndefined();
		expect(body.include).toBeUndefined();
	} finally { await fs.rm(root, { recursive: true, force: true }); }
});
