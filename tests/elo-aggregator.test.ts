import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { eloAggregate } from "../src/elo-aggregator.js";

function makeTempDir(): string {
    const dir = resolve(tmpdir(), `vibe-test-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function writeComparison(
    evaluationsDir: string,
    task: string,
    modelDirA: string,
    modelDirB: string,
    judge: string,
    winner: "A" | "B" | "tie",
    criterionWinners: Record<string, "A" | "B" | "tie"> = {},
): void {
    const eloDir = resolve(evaluationsDir, task, "elo");
    mkdirSync(eloDir, { recursive: true });
    const judgeDir = judge.replace(/\//g, "__");
    const filename = `${modelDirA}__vs__${modelDirB}__${judgeDir}.json`;
    writeFileSync(
        resolve(eloDir, filename),
        JSON.stringify({
            judge,
            modelA: modelDirA.replace(/__/, "/"),
            modelB: modelDirB.replace(/__/, "/"),
            winner,
            criterionWinners,
            reasoning: "test reasoning",
        }),
    );
}

describe("eloAggregate", () => {
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

    it("returns empty results if evaluations dir does not exist", () => {
        const results = eloAggregate(resolve(tempDir, "nonexistent"));
        expect(results.models).toEqual([]);
        expect(results.matchups).toEqual([]);
    });

    it("returns empty results if no elo subdirectories exist", () => {
        // Create a task dir without an elo subdir
        mkdirSync(resolve(evalsDir, "task_a"), { recursive: true });
        const results = eloAggregate(evalsDir);
        expect(results.models).toEqual([]);
    });

    it("computes ELO from a single comparison (A wins)", () => {
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "A");

        const results = eloAggregate(evalsDir);
        expect(results.models).toHaveLength(2);

        // A should have higher ELO than B
        const modelA = results.models.find((m) => m.model === "model__alpha")!;
        const modelB = results.models.find((m) => m.model === "model__beta")!;
        expect(modelA.elo).toBeGreaterThan(modelB.elo);
        expect(modelA.wins).toBe(1);
        expect(modelA.losses).toBe(0);
        expect(modelB.wins).toBe(0);
        expect(modelB.losses).toBe(1);
    });

    it("computes ELO from a single comparison (B wins)", () => {
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "B");

        const results = eloAggregate(evalsDir);
        const modelA = results.models.find((m) => m.model === "model__alpha")!;
        const modelB = results.models.find((m) => m.model === "model__beta")!;
        expect(modelB.elo).toBeGreaterThan(modelA.elo);
    });

    it("handles ties correctly", () => {
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "tie");

        const results = eloAggregate(evalsDir);
        const modelA = results.models.find((m) => m.model === "model__alpha")!;
        const modelB = results.models.find((m) => m.model === "model__beta")!;

        // With a tie, both should stay at ~1500
        expect(modelA.elo).toBe(modelB.elo);
        expect(modelA.ties).toBe(1);
        expect(modelB.ties).toBe(1);
    });

    it("ranks models by ELO descending", () => {
        // alpha beats beta, beta beats gamma → alpha > beta > gamma
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "A");
        writeComparison(evalsDir, "task_a", "model__beta", "model__gamma", "judge/one", "A");
        writeComparison(evalsDir, "task_a", "model__alpha", "model__gamma", "judge/one", "A");

        const results = eloAggregate(evalsDir);
        expect(results.models).toHaveLength(3);
        expect(results.models[0]!.model).toBe("model__alpha");
        // gamma should be last
        expect(results.models[2]!.model).toBe("model__gamma");
    });

    it("computes correct win/loss counts across multiple tasks and judges", () => {
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "A");
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/two", "A");
        writeComparison(evalsDir, "task_b", "model__alpha", "model__beta", "judge/one", "B");

        const results = eloAggregate(evalsDir);
        const modelA = results.models.find((m) => m.model === "model__alpha")!;
        expect(modelA.wins).toBe(2);
        expect(modelA.losses).toBe(1);
    });

    it("computes head-to-head matchups", () => {
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "A");
        writeComparison(evalsDir, "task_b", "model__alpha", "model__beta", "judge/one", "B");
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/two", "tie");

        const results = eloAggregate(evalsDir);
        expect(results.matchups).toHaveLength(1);

        const mu = results.matchups[0]!;
        // Canonical order is alphabetically: alpha < beta
        expect(mu.modelA).toBe("model__alpha");
        expect(mu.modelB).toBe("model__beta");
        expect(mu.winsA).toBe(1);
        expect(mu.winsB).toBe(1);
        expect(mu.ties).toBe(1);
    });

    it("includes per-task ELO", () => {
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "A");
        writeComparison(evalsDir, "task_b", "model__alpha", "model__beta", "judge/one", "B");

        const results = eloAggregate(evalsDir);
        const modelA = results.models.find((m) => m.model === "model__alpha")!;
        expect(modelA.taskElos).toHaveProperty("task_a");
        expect(modelA.taskElos).toHaveProperty("task_b");
        // In task_a alpha wins → higher elo, in task_b alpha loses → lower elo
        expect(modelA.taskElos["task_a"]).toBeGreaterThan(modelA.taskElos["task_b"]!);
    });

    it("scales ELO to 0-100 with min-max", () => {
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "A");

        const results = eloAggregate(evalsDir);
        const top = results.models[0]!;
        const bottom = results.models[1]!;
        expect(top.scaled).toBe(100);
        expect(bottom.scaled).toBe(0);
    });

    it("handles all equal models (all ties) → scaled to 50", () => {
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "tie");

        const results = eloAggregate(evalsDir);
        for (const m of results.models) {
            expect(m.scaled).toBe(50);
        }
    });

    it("skips malformed JSON files gracefully", () => {
        const eloDir = resolve(evalsDir, "task_a", "elo");
        mkdirSync(eloDir, { recursive: true });
        writeFileSync(resolve(eloDir, "bad__vs__file__judge__one.json"), "not json");
        writeComparison(evalsDir, "task_a", "model__alpha", "model__beta", "judge/one", "A");

        const results = eloAggregate(evalsDir);
        expect(results.models).toHaveLength(2);
    });

    it("ELO is order-independent: model with more wins always ranks higher", () => {
        // Regression: a model with 18W/42L must never outrank a model with 41W/19L.
        // Write matches so model__strong beats model__weak in most matchups,
        // but model__weak's few wins come against a highly-rated opponent.
        // With batch updates this should always produce correct rankings.
        const judges = ["judge/one", "judge/two", "judge/three"];
        const tasks = ["task_a", "task_b"];

        // strong beats weak across all tasks and judges (6 wins for strong)
        for (const task of tasks) {
            for (const judge of judges) {
                writeComparison(evalsDir, task, "model__strong", "model__weak", judge, "A");
            }
        }
        // weak beats decoy in 1 task (3 wins for weak)
        for (const judge of judges) {
            writeComparison(evalsDir, "task_a", "model__weak", "model__decoy", judge, "A");
        }
        // strong loses to decoy in 1 task (3 losses for strong, but still net positive)
        for (const judge of judges) {
            writeComparison(evalsDir, "task_a", "model__strong", "model__decoy", judge, "B");
        }

        const results = eloAggregate(evalsDir);
        const strong = results.models.find((m) => m.model === "model__strong")!;
        const weak = results.models.find((m) => m.model === "model__weak")!;

        // strong: 6W, 3L; weak: 3W, 6L → strong must rank higher
        expect(strong.wins).toBe(6);
        expect(weak.wins).toBe(3);
        expect(strong.elo).toBeGreaterThan(weak.elo);
    });

    it("handles many models with a clear dominance hierarchy", () => {
        const models = ["model__a", "model__b", "model__c", "model__d"];
        // a > b > c > d (a beats everyone, d loses to everyone)
        for (let i = 0; i < models.length; i++) {
            for (let j = i + 1; j < models.length; j++) {
                writeComparison(evalsDir, "task_a", models[i]!, models[j]!, "judge/one", "A");
            }
        }

        const results = eloAggregate(evalsDir);
        expect(results.models).toHaveLength(4);
        expect(results.models[0]!.model).toBe("model__a");
        expect(results.models[3]!.model).toBe("model__d");
        expect(results.models[0]!.scaled).toBe(100);
        expect(results.models[3]!.scaled).toBe(0);
    });
});
