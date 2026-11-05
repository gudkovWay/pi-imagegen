import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { ToolParams } from "./imagegen";

export const DEFAULT_RESPONSE_MODEL = "gpt-5.5";
export const IMAGE_MODEL = "gpt-image-2";

export function mimeFromFormat(format: string): string {
	if (format === "jpeg") return "image/jpeg";
	if (format === "webp") return "image/webp";
	return "image/png";
}

export async function buildRequest(params: ToolParams, sessionId: string) {
	const size = params.size ?? "auto";
	const quality = params.quality ?? "auto";
	const background = params.background ?? "auto";
	const outputFormat = params.outputFormat ?? "png";
	const thinking = params.thinking ?? "low";
	const content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }> = [
		{ type: "input_text", text: `Generate this image: ${params.prompt}` },
	];
	for (const path of params.referencePaths ?? []) {
		const format = extname(path).toLowerCase() === ".jpg" ? "jpeg" : extname(path).toLowerCase().replace(/^\./, "") || "png";
		const mimeType = mimeFromFormat(format);
		const data = await readFile(path);
		content.push({ type: "input_image", image_url: `data:${mimeType};base64,${data.toString("base64")}` });
	}
	const request = {
		model: DEFAULT_RESPONSE_MODEL,
		store: false,
		stream: true,
		instructions:
			"You are an image generation dispatcher. Use the image_generation tool to create exactly the image requested by the user. Do not write code.",
		input: [
			{
				role: "user",
				content,
			},
		],
		text: { verbosity: "low" },
		prompt_cache_key: sessionId,
		tool_choice: "auto",
		parallel_tool_calls: true,
		tools: [
			{
				type: "image_generation",
				background,
				model: IMAGE_MODEL,
				moderation: "auto",
				output_compression: 100,
				output_format: outputFormat,
				quality,
				size,
			},
		],
		...(thinking === "off" ? {} : {
			include: ["reasoning.encrypted_content"],
			reasoning: { effort: thinking, summary: "auto" },
		}),
	};
	return request;
}
