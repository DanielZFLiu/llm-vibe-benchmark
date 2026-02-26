import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { aggregate } from "../src/aggregator.js";

function makeTempDir(): string {
    const dir = resolve(tmpdir(), `vibe-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function writeEval(
    evaluationsDir: string,
    task: string,
    model: string,
    judge: string,
    scores: Record<string, number>,
): void {
    const taskDir = resolve(evaluationsDir, task);
    mkdirSync(taskDir, { recursive: true });
    const filename = `${model}__${judge.replace(/\//g, "__")}.json`;
    writeFileSync(
        resolve(taskDir, filename),
        JSON.stringify({
            judge,
            reasoning: "test reasoning",
            scores,
        }),
    );
}

describe("aggregate", () => {
    let tempDir: string;
    let evalsDir: string;

    beforeEach(() => {
        tempDir = makeTempDir();
        evalsDir = resolve(tempDir, "evaluations");
        mkdirSync(evalsDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    it("returns empty array if evaluations dir does not exist", () => {
        rmSync(evalsDir, { recursive: true, force: true });
        const stats = aggregate(resolve(tempDir, "nonexistent"));
        expect(stats).toEqual([]);
    });

    it("aggregates scores from a single judge and task", () => {
        writeEval(evalsDir, "task_a", "model_a", "judge-1", {
            correctness: 80,
            clarity: 90,
        });

        const stats = aggregate(evalsDir);
        expect(stats).toHaveLength(1);
        expect(stats[0]!.model).toBe("model_a");
        expect(stats[0]!.avgScore).toBe(85); // (80+90)/2
    });

    it("averages across multiple judges", () => {
        writeEval(evalsDir, "task_a", "model_a", "judge-1", {
            score: 80,
        });
        writeEval(evalsDir, "task_a", "model_a", "judge-2", {
            score: 60,
        });

        const stats = aggregate(evalsDir);
        expect(stats).toHaveLength(1);
        // judge-1 avg = 80, judge-2 avg = 60, task avg = (80+60)/2 = 70
        expect(stats[0]!.avgScore).toBe(70);
    });

    it("ranks models by average score descending", () => {
        writeEval(evalsDir, "task_a", "model_low", "judge-1", {
            score: 40,
        });
        writeEval(evalsDir, "task_a", "model_high", "judge-1", {
            score: 95,
        });
        writeEval(evalsDir, "task_a", "model_mid", "judge-1", {
            score: 70,
        });

        const stats = aggregate(evalsDir);
        expect(stats.map((s) => s.model)).toEqual([
            "model_high",
            "model_mid",
            "model_low",
        ]);
    });

    it("computes standard deviation across tasks", () => {
        // model_a: task_a = 90, task_b = 70 → avg = 80, stddev = 10
        writeEval(evalsDir, "task_a", "model_a", "judge-1", {
            score: 90,
        });
        writeEval(evalsDir, "task_b", "model_a", "judge-1", {
            score: 70,
        });

        const stats = aggregate(evalsDir);
        expect(stats[0]!.avgScore).toBe(80);
        expect(stats[0]!.stdDev).toBe(10);
    });

    it("identifies best and worst tasks", () => {
        writeEval(evalsDir, "snake_game", "model_a", "judge-1", {
            score: 95,
        });
        writeEval(evalsDir, "summarize", "model_a", "judge-1", {
            score: 60,
        });
        writeEval(evalsDir, "algorithm", "model_a", "judge-1", {
            score: 80,
        });

        const stats = aggregate(evalsDir);
        expect(stats[0]!.bestTask).toBe("snake_game");
        expect(stats[0]!.worstTask).toBe("summarize");
    });

    it("tracks per-task scores", () => {
        writeEval(evalsDir, "task_a", "model_x", "judge-1", {
            score: 88,
        });
        writeEval(evalsDir, "task_b", "model_x", "judge-1", {
            score: 72,
        });

        const stats = aggregate(evalsDir);
        expect(stats[0]!.taskScores["task_a"]).toBe(88);
        expect(stats[0]!.taskScores["task_b"]).toBe(72);
    });

    it("handles multiple models across multiple tasks", () => {
        writeEval(evalsDir, "task_a", "model_1", "judge-1", { score: 90 });
        writeEval(evalsDir, "task_b", "model_1", "judge-1", { score: 80 });
        writeEval(evalsDir, "task_a", "model_2", "judge-1", { score: 70 });
        writeEval(evalsDir, "task_b", "model_2", "judge-1", { score: 60 });

        const stats = aggregate(evalsDir);
        expect(stats).toHaveLength(2);
        // model_1: avg = 85, model_2: avg = 65
        expect(stats[0]!.model).toBe("model_1");
        expect(stats[0]!.avgScore).toBe(85);
        expect(stats[1]!.model).toBe("model_2");
        expect(stats[1]!.avgScore).toBe(65);
    });

    it("skips malformed JSON files gracefully", () => {
        const taskDir = resolve(evalsDir, "task_a");
        mkdirSync(taskDir, { recursive: true });
        writeFileSync(
            resolve(taskDir, "model_a__judge-1.json"),
            "not valid json",
        );
        writeEval(evalsDir, "task_a", "model_b", "judge-1", { score: 80 });

        const stats = aggregate(evalsDir);
        // model_a should be skipped, only model_b should appear
        expect(stats).toHaveLength(1);
        expect(stats[0]!.model).toBe("model_b");
    });

    it("returns zero stdDev for model with single task", () => {
        writeEval(evalsDir, "task_a", "model_a", "judge-1", {
            score: 85,
        });

        const stats = aggregate(evalsDir);
        expect(stats[0]!.stdDev).toBe(0);
    });
});
