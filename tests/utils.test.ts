import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
    sanitizeModelName,
    discoverTasks,
    readPrompt,
    withRetry,
    sleep,
    ensureDir,
    runConcurrent,
} from "../src/utils.js";

function makeTempDir(): string {
    const dir = resolve(tmpdir(), `vibe-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

describe("sanitizeModelName", () => {
    it("replaces slashes with double underscores", () => {
        expect(sanitizeModelName("openai/gpt-5.2")).toBe("openai__gpt-5.2");
    });

    it("handles multiple slashes", () => {
        expect(sanitizeModelName("org/sub/model")).toBe("org__sub__model");
    });

    it("returns unchanged string with no slashes", () => {
        expect(sanitizeModelName("model-name")).toBe("model-name");
    });
});

describe("discoverTasks", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = makeTempDir();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("discovers task folders with prompt.txt", () => {
        const task1 = resolve(tempDir, "task_a");
        const task2 = resolve(tempDir, "task_b");
        mkdirSync(task1);
        mkdirSync(task2);
        writeFileSync(resolve(task1, "prompt.txt"), "Do task A");
        writeFileSync(resolve(task2, "prompt.txt"), "Do task B");

        const tasks = discoverTasks(tempDir);
        expect(tasks).toEqual(["task_a", "task_b"]);
    });

    it("skips folders without prompt.txt", () => {
        const withPrompt = resolve(tempDir, "valid_task");
        const withoutPrompt = resolve(tempDir, "invalid_task");
        mkdirSync(withPrompt);
        mkdirSync(withoutPrompt);
        writeFileSync(resolve(withPrompt, "prompt.txt"), "Do it");

        const tasks = discoverTasks(tempDir);
        expect(tasks).toEqual(["valid_task"]);
    });

    it("ignores files (non-directories)", () => {
        writeFileSync(resolve(tempDir, "readme.txt"), "not a task");
        const task = resolve(tempDir, "real_task");
        mkdirSync(task);
        writeFileSync(resolve(task, "prompt.txt"), "Do it");

        const tasks = discoverTasks(tempDir);
        expect(tasks).toEqual(["real_task"]);
    });

    it("returns tasks in sorted order", () => {
        for (const name of ["zebra", "alpha", "middle"]) {
            const dir = resolve(tempDir, name);
            mkdirSync(dir);
            writeFileSync(resolve(dir, "prompt.txt"), `task ${name}`);
        }

        const tasks = discoverTasks(tempDir);
        expect(tasks).toEqual(["alpha", "middle", "zebra"]);
    });

    it("throws if tasks directory does not exist", () => {
        expect(() => discoverTasks("/nonexistent/path")).toThrow(
            "Tasks directory not found",
        );
    });

    it("throws if no valid tasks found", () => {
        expect(() => discoverTasks(tempDir)).toThrow("No valid tasks found");
    });
});

describe("readPrompt", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = makeTempDir();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("reads and trims the prompt file", () => {
        const taskDir = resolve(tempDir, "my_task");
        mkdirSync(taskDir);
        writeFileSync(resolve(taskDir, "prompt.txt"), "  Build a snake game  \n");

        const prompt = readPrompt(tempDir, "my_task");
        expect(prompt).toBe("Build a snake game");
    });
});

describe("ensureDir", () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = makeTempDir();
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("creates a directory that does not exist", () => {
        const newDir = resolve(tempDir, "a", "b", "c");
        ensureDir(newDir);
        // Should not throw on second call
        ensureDir(newDir);
    });
});

describe("sleep", () => {
    it("resolves after the specified duration", async () => {
        const start = Date.now();
        await sleep(50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(40);
    });
});

describe("withRetry", () => {
    it("returns result on first success", async () => {
        const result = await withRetry(() => Promise.resolve("ok"), 3, 10);
        expect(result).toBe("ok");
    });

    it("retries on failure and succeeds", async () => {
        let attempt = 0;
        const result = await withRetry(
            () => {
                attempt++;
                if (attempt < 3) throw new Error("fail");
                return Promise.resolve("recovered");
            },
            3,
            10,
        );
        expect(result).toBe("recovered");
        expect(attempt).toBe(3);
    });

    it("throws after all retries exhausted", async () => {
        await expect(
            withRetry(
                () => {
                    throw new Error("always fails");
                },
                2,
                10,
            ),
        ).rejects.toThrow("always fails");
    });

    it("respects retry count", async () => {
        let attempts = 0;
        try {
            await withRetry(
                () => {
                    attempts++;
                    throw new Error("fail");
                },
                4,
                10,
            );
        } catch {
            // expected
        }
        expect(attempts).toBe(4);
    });
});

describe("runConcurrent", () => {
    it("processes all items in the queue", async () => {
        const results: number[] = [];
        await runConcurrent([1, 2, 3, 4], 2, async (item) => {
            results.push(item);
        });
        expect(results.sort()).toEqual([1, 2, 3, 4]);
    });

    it("respects maxConcurrency", async () => {
        let active = 0;
        let maxActive = 0;
        await runConcurrent([1, 2, 3, 4, 5], 2, async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await sleep(20);
            active--;
        });
        expect(maxActive).toBeLessThanOrEqual(2);
    });

    it("handles empty queue", async () => {
        let called = false;
        await runConcurrent([], 3, async () => {
            called = true;
        });
        expect(called).toBe(false);
    });
});
