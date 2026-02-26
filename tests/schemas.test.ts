import { describe, it, expect } from "vitest";
import {
    BenchmarkConfigSchema,
    CriterionSchema,
    TaskCriteriaSchema,
    JudgeScoreSchema,
    EvaluationResultSchema,
    DEFAULT_CRITERIA,
} from "../src/schemas.js";

describe("BenchmarkConfigSchema", () => {
    it("accepts a valid config", () => {
        const result = BenchmarkConfigSchema.safeParse({
            setC: ["openai/gpt-5.2"],
            setJ: ["openai/gpt-5.3-codex"],
            tasksDir: "./tasks",
            responsesDir: "./responses",
            evaluationsDir: "./evaluations",
            maxConcurrency: 3,
        });
        expect(result.success).toBe(true);
    });

    it("applies defaults for optional fields", () => {
        const result = BenchmarkConfigSchema.parse({
            setC: ["model-a"],
            setJ: ["judge-a"],
        });
        expect(result.tasksDir).toBe("./tasks");
        expect(result.responsesDir).toBe("./responses");
        expect(result.evaluationsDir).toBe("./evaluations");
        expect(result.maxConcurrency).toBe(3);
    });

    it("rejects empty setC", () => {
        const result = BenchmarkConfigSchema.safeParse({
            setC: [],
            setJ: ["judge"],
        });
        expect(result.success).toBe(false);
    });

    it("rejects empty setJ", () => {
        const result = BenchmarkConfigSchema.safeParse({
            setC: ["model"],
            setJ: [],
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing setC", () => {
        const result = BenchmarkConfigSchema.safeParse({
            setJ: ["judge"],
        });
        expect(result.success).toBe(false);
    });

    it("rejects non-positive maxConcurrency", () => {
        const result = BenchmarkConfigSchema.safeParse({
            setC: ["model"],
            setJ: ["judge"],
            maxConcurrency: 0,
        });
        expect(result.success).toBe(false);
    });

    it("rejects non-integer maxConcurrency", () => {
        const result = BenchmarkConfigSchema.safeParse({
            setC: ["model"],
            setJ: ["judge"],
            maxConcurrency: 2.5,
        });
        expect(result.success).toBe(false);
    });
});

describe("CriterionSchema", () => {
    it("accepts a criterion with name and description", () => {
        const result = CriterionSchema.safeParse({
            name: "correctness",
            description: "Is it correct?",
        });
        expect(result.success).toBe(true);
    });

    it("accepts a criterion with optional rubric", () => {
        const result = CriterionSchema.parse({
            name: "correctness",
            description: "Is it correct?",
            rubric: "90-100: perfect. 0-30: broken.",
        });
        expect(result.rubric).toBe("90-100: perfect. 0-30: broken.");
    });

    it("rejects missing name", () => {
        const result = CriterionSchema.safeParse({
            description: "something",
        });
        expect(result.success).toBe(false);
    });
});

describe("TaskCriteriaSchema", () => {
    it("accepts valid criteria array", () => {
        const result = TaskCriteriaSchema.safeParse({
            criteria: [{ name: "a", description: "b" }],
        });
        expect(result.success).toBe(true);
    });

    it("rejects empty criteria array", () => {
        const result = TaskCriteriaSchema.safeParse({
            criteria: [],
        });
        expect(result.success).toBe(false);
    });
});

describe("JudgeScoreSchema", () => {
    it("accepts valid judge score", () => {
        const result = JudgeScoreSchema.safeParse({
            judge: "gpt-5",
            reasoning: "Good work",
            scores: { correctness: 85, richness: 90 },
        });
        expect(result.success).toBe(true);
    });

    it("rejects scores outside 0-100", () => {
        const over = JudgeScoreSchema.safeParse({
            judge: "gpt-5",
            reasoning: "ok",
            scores: { correctness: 101 },
        });
        expect(over.success).toBe(false);

        const under = JudgeScoreSchema.safeParse({
            judge: "gpt-5",
            reasoning: "ok",
            scores: { correctness: -1 },
        });
        expect(under.success).toBe(false);
    });

    it("accepts boundary values 0 and 100", () => {
        const result = JudgeScoreSchema.safeParse({
            judge: "gpt-5",
            reasoning: "ok",
            scores: { a: 0, b: 100 },
        });
        expect(result.success).toBe(true);
    });

    it("rejects missing reasoning", () => {
        const result = JudgeScoreSchema.safeParse({
            judge: "gpt-5",
            scores: { a: 50 },
        });
        expect(result.success).toBe(false);
    });
});

describe("EvaluationResultSchema", () => {
    it("accepts a valid evaluation result", () => {
        const result = EvaluationResultSchema.safeParse({
            task: "snake_game",
            model: "claude",
            scores: [
                {
                    judge: "gpt-5",
                    reasoning: "analysis",
                    scores: { correctness: 85 },
                },
            ],
            average: 85,
        });
        expect(result.success).toBe(true);
    });
});

describe("DEFAULT_CRITERIA", () => {
    it("has 4 criteria", () => {
        expect(DEFAULT_CRITERIA).toHaveLength(4);
    });

    it("each criterion has name and description", () => {
        for (const c of DEFAULT_CRITERIA) {
            expect(c.name).toBeTruthy();
            expect(c.description).toBeTruthy();
        }
    });

    it("all default criteria pass schema validation", () => {
        for (const c of DEFAULT_CRITERIA) {
            const result = CriterionSchema.safeParse(c);
            expect(result.success).toBe(true);
        }
    });
});
