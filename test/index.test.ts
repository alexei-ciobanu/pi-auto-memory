import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildMemoryPrompt,
	encodeProjectPath,
	loadMemorySnapshot,
	MAX_MEMORY_INDEX_BYTES,
	MAX_MEMORY_INDEX_LINES,
	registerAutoMemoryExtension,
	resolveMemoryPaths,
	truncateMemoryIndex,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

async function makeTempDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-auto-memory-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("memory paths", () => {
	it("uses Pi's launch-CWD encoding and separates global and project memory", async () => {
		const agentDir = await makeTempDirectory();
		const cwd = "/home/alexe/projects/example";
		const paths = resolveMemoryPaths(cwd, agentDir);

		expect(encodeProjectPath(cwd)).toBe("--home-alexe-projects-example--");
		expect(paths.globalIndex).toBe(join(resolve(agentDir), "memory", "MEMORY.md"));
		expect(paths.projectIndex).toBe(
			join(resolve(agentDir), "memory", "projects", "--home-alexe-projects-example--", "MEMORY.md"),
		);
	});
});

describe("memory index loading", () => {
	it("loads global and project indexes into one session snapshot", async () => {
		const agentDir = await makeTempDirectory();
		const cwd = await makeTempDirectory();
		const paths = resolveMemoryPaths(cwd, agentDir);
		const initial = loadMemorySnapshot(cwd, agentDir);

		expect(initial.global.exists).toBe(false);
		expect(initial.project.exists).toBe(false);

		await writeFile(paths.globalIndex, "# Global\n\n- concise answers\n", "utf8");
		await writeFile(paths.projectIndex, "# Project\n\n- use Node.js\n", "utf8");

		const loaded = loadMemorySnapshot(cwd, agentDir);
		expect(loaded.global.content).toContain("concise answers");
		expect(loaded.project.content).toContain("use Node.js");
		expect(await readFile(paths.globalIndex, "utf8")).toContain("# Global");
	});

	it("limits indexes by lines", () => {
		const raw = Array.from({ length: MAX_MEMORY_INDEX_LINES + 10 }, (_, index) => `line ${index}`).join("\n");
		const result = truncateMemoryIndex(raw);

		expect(result.truncated).toBe(true);
		expect(result.content).toContain("line 199");
		expect(result.content).not.toContain("line 200\n");
		expect(result.content).toContain("Index truncated while loading");
	});

	it("limits indexes by UTF-8 bytes without splitting a character", () => {
		const raw = `${"a".repeat(MAX_MEMORY_INDEX_BYTES - 1)}🙂tail`;
		const result = truncateMemoryIndex(raw);
		const beforeWarning = result.content.split("\n\n> Index truncated")[0] ?? "";

		expect(result.truncated).toBe(true);
		expect(Buffer.byteLength(beforeWarning, "utf8")).toBeLessThanOrEqual(MAX_MEMORY_INDEX_BYTES);
		expect(beforeWarning.endsWith("�")).toBe(false);
	});
});

describe("system prompt", () => {
	it("includes stable snapshots, paths, scope rules, and credential safety", async () => {
		const agentDir = await makeTempDirectory();
		const cwd = await makeTempDirectory();
		const paths = resolveMemoryPaths(cwd, agentDir);
		loadMemorySnapshot(cwd, agentDir);
		await writeFile(paths.globalIndex, "- prefers concise replies", "utf8");
		await writeFile(paths.projectIndex, "- project uses Bun", "utf8");

		const prompt = buildMemoryPrompt(loadMemorySnapshot(cwd, agentDir));
		expect(prompt.startsWith("<memory_context>\n\nPersistent memory")).toBe(true);
		expect(prompt.endsWith("</memory_context>")).toBe(true);
		expect(prompt).toContain(`<global_memory_index path="${paths.globalIndex}">`);
		expect(prompt).toContain(`<project_memory_index path="${paths.projectIndex}">`);
		expect(prompt).toContain("prefers concise replies");
		expect(prompt).toContain("project uses Bun");
		expect(prompt).toContain("standard file-reading and file-editing tools");
		expect(prompt).not.toContain("there is no dedicated memory tool");
		expect(prompt).not.toContain("Memory scopes:");
		expect(prompt).toContain("Never save passwords");
		expect(prompt).toContain("snapshot taken when this session started");
	});

	it("keeps a fixed snapshot until the next session start", async () => {
		interface TestContext {
			cwd: string;
			ui: { notify: (message: string, level: string) => void };
		}
		type TestHandler = (event: Record<string, unknown>, context: TestContext) => unknown;

		const handlers = new Map<string, TestHandler>();
		const api = {
			on(eventName: string, handler: TestHandler) {
				handlers.set(eventName, handler);
			},
		} as unknown as ExtensionAPI;
		const agentDir = await makeTempDirectory();
		const cwd = await makeTempDirectory();
		const paths = resolveMemoryPaths(cwd, agentDir);
		const context: TestContext = { cwd, ui: { notify: () => undefined } };

		registerAutoMemoryExtension(api, { getAgentDirectory: () => agentDir });
		const sessionStart = handlers.get("session_start");
		const beforeAgentStart = handlers.get("before_agent_start");
		expect(sessionStart).toBeDefined();
		expect(beforeAgentStart).toBeDefined();
		if (!sessionStart || !beforeAgentStart) throw new Error("Expected extension handlers");

		sessionStart({}, context);
		await writeFile(paths.globalIndex, "- written after startup", "utf8");

		const beforeReload = beforeAgentStart({ systemPrompt: "BASE" }, context) as { systemPrompt: string };
		expect(beforeReload.systemPrompt).toContain("BASE");
		expect(beforeReload.systemPrompt).not.toContain("written after startup");

		sessionStart({}, context);
		const afterReload = beforeAgentStart({ systemPrompt: "BASE" }, context) as { systemPrompt: string };
		expect(afterReload.systemPrompt).toContain("written after startup");
	});
});
