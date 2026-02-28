import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { loadConfig, getApiKey, loadTaskCriteria, loadTaskConfig } from "../src/config.js";

function makeTempDir(): string {
    const dir = resolve(tmpdir(), `vibe-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

describe("loadConfig", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = makeTempDir();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("loads a valid config file", () => {
        const config = {
            setC: ["model-a"],
            setJ: ["judge-a"],
            tasksDir: "./tasks",
            responsesDir: "./responses",
            evaluationsDir: "./evaluations",
            maxConcurrency: 2,
        };
        writeFileSync(
            resolve(tempDir, "benchmark.config.json"),
            JSON.stringify(config),
        );

        const result = loadConfig(tempDir);
        expect(result.setC).toEqual(["model-a"]);
        expect(result.setJ).toEqual(["judge-a"]);
        expect(result.maxConcurrency).toBe(2);
    });

    it("applies defaults when optional fields are missing", () => {
        writeFileSync(
            resolve(tempDir, "benchmark.config.json"),
            JSON.stringify({ setC: ["m"], setJ: ["j"] }),
        );

        const result = loadConfig(tempDir);
        expect(result.tasksDir).toBe("./tasks");
        expect(result.responsesDir).toBe("./responses");
        expect(result.evaluationsDir).toBe("./evaluations");
        expect(result.maxConcurrency).toBe(3);
    });

    it("throws if config file does not exist", () => {
        expect(() => loadConfig(tempDir)).toThrow("Config file not found");
    });

    it("throws on invalid config (empty setC)", () => {
        writeFileSync(
            resolve(tempDir, "benchmark.config.json"),
            JSON.stringify({ setC: [], setJ: ["j"] }),
        );
        expect(() => loadConfig(tempDir)).toThrow("Invalid config");
    });

    it("throws on malformed JSON", () => {
        writeFileSync(
            resolve(tempDir, "benchmark.config.json"),
            "not json!!!",
        );
        expect(() => loadConfig(tempDir)).toThrow();
    });
});

describe("getApiKey", () => {
    const originalEnv = process.env.OPENROUTER_API_KEY;

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.OPENROUTER_API_KEY = originalEnv;
        } else {
            delete process.env.OPENROUTER_API_KEY;
        }
    });

    it("returns the API key from env", () => {
        process.env.OPENROUTER_API_KEY = "test-key-123";
        expect(getApiKey()).toBe("test-key-123");
    });

    it("throws if OPENROUTER_API_KEY is not set", () => {
        delete process.env.OPENROUTER_API_KEY;
        expect(() => getApiKey()).toThrow("OPENROUTER_API_KEY");
    });
});

describe("loadTaskCriteria", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = makeTempDir();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("returns default criteria when no criteria.json exists", () => {
        const criteria = loadTaskCriteria(tempDir);
        expect(criteria).toHaveLength(4);
        expect(criteria[0]!.name).toBe("completeness");
    });

    it("loads custom criteria from criteria.json", () => {
        const custom = {
            criteria: [
                { name: "speed", description: "Is it fast?" },
                { name: "style", description: "Is it pretty?" },
            ],
        };
        writeFileSync(
            resolve(tempDir, "criteria.json"),
            JSON.stringify(custom),
        );

        const criteria = loadTaskCriteria(tempDir);
        expect(criteria).toHaveLength(2);
        expect(criteria[0]!.name).toBe("speed");
        expect(criteria[1]!.name).toBe("style");
    });

    it("loads criteria with rubric anchors", () => {
        const custom = {
            criteria: [
                {
                    name: "correctness",
                    description: "Does it work?",
                    rubric: "90-100: flawless. 0-30: broken.",
                },
            ],
        };
        writeFileSync(
            resolve(tempDir, "criteria.json"),
            JSON.stringify(custom),
        );

        const criteria = loadTaskCriteria(tempDir);
        expect(criteria[0]!.rubric).toBe("90-100: flawless. 0-30: broken.");
    });

    it("falls back to defaults on invalid criteria.json", () => {
        writeFileSync(
            resolve(tempDir, "criteria.json"),
            JSON.stringify({ criteria: [] }),
        );

        const criteria = loadTaskCriteria(tempDir);
        expect(criteria).toHaveLength(4);
    });

    it("falls back to defaults on malformed JSON", () => {
        writeFileSync(resolve(tempDir, "criteria.json"), "not json!");

        // Should not throw, just warn and return defaults
        const criteria = loadTaskCriteria(tempDir);
        expect(criteria).toHaveLength(4);
    });
});

describe("loadTaskConfig", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = makeTempDir();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("returns null when no task.json exists", () => {
        expect(loadTaskConfig(tempDir)).toBeNull();
    });

    it("loads maxTokens from task.json", () => {
        writeFileSync(
            resolve(tempDir, "task.json"),
            JSON.stringify({ maxTokens: 32768 }),
        );
        const config = loadTaskConfig(tempDir);
        expect(config).not.toBeNull();
        expect(config!.maxTokens).toBe(32768);
    });

    it("loads systemPrompt from task.json", () => {
        writeFileSync(
            resolve(tempDir, "task.json"),
            JSON.stringify({ systemPrompt: "You are a helpful assistant." }),
        );
        const config = loadTaskConfig(tempDir);
        expect(config).not.toBeNull();
        expect(config!.systemPrompt).toBe("You are a helpful assistant.");
    });

    it("loads both maxTokens and systemPrompt together", () => {
        writeFileSync(
            resolve(tempDir, "task.json"),
            JSON.stringify({ maxTokens: 16384, systemPrompt: "Be concise." }),
        );
        const config = loadTaskConfig(tempDir);
        expect(config!.maxTokens).toBe(16384);
        expect(config!.systemPrompt).toBe("Be concise.");
    });

    it("returns null with an empty object (all fields optional)", () => {
        writeFileSync(resolve(tempDir, "task.json"), JSON.stringify({}));
        const config = loadTaskConfig(tempDir);
        expect(config).not.toBeNull();
        expect(config!.maxTokens).toBeUndefined();
        expect(config!.systemPrompt).toBeUndefined();
    });

    it("returns null on malformed JSON", () => {
        writeFileSync(resolve(tempDir, "task.json"), "not json!");
        expect(loadTaskConfig(tempDir)).toBeNull();
    });

    it("returns null on invalid schema (negative maxTokens)", () => {
        writeFileSync(
            resolve(tempDir, "task.json"),
            JSON.stringify({ maxTokens: -1 }),
        );
        expect(loadTaskConfig(tempDir)).toBeNull();
    });
});
