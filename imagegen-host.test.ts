import { expect, test } from "bun:test";
import * as path from "node:path";

// The OMP compatibility loader supplies upstream pi modules; no provider credentials are used.
const hostRoot = process.env.OMP_TEST_HOST_ROOT;

test.skipIf(!hostRoot)("registered imagegen dispatches once through the image model despite an active coding model", async () => {
	const { loadExtensions } = await import(path.join(hostRoot!, "packages/coding-agent/src/extensibility/extensions/loader.ts"));
	const extensionPath = process.env.IMAGEGEN_TEST_EXTENSION ?? path.join(import.meta.dir, "imagegen.ts");
	const loaded = await loadExtensions([extensionPath], path.dirname(extensionPath));
	expect(loaded.errors).toEqual([]);
	const tool = loaded.extensions[0]?.tools.get("imagegen")?.definition;
	expect(tool).toBeDefined();
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; body: unknown }> = [];
	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return new Response('{"error":{"code":"model_not_found"}}', { status: 400 });
	}) as typeof fetch;
	const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url");
	try {
		await expect(tool!.execute("fixture", { prompt: "a cube" }, undefined, undefined, {
			cwd: import.meta.dir, model: { provider: "openai-codex", id: "gpt-6.1-sol" },
			modelRegistry: { getApiKeyForProvider: async () => `fixture.${claims}.signature` },
		})).rejects.toThrow("Codex image request failed (400)");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://chatgpt.com/backend-api/codex/responses");
		expect(calls[0]?.body).toMatchObject({ model: "gpt-5.5", tools: [{ model: "gpt-image-2" }] });
	} finally {
		globalThis.fetch = originalFetch;
	}
});
