import { describe, it, expect } from "vitest";
import {
    buildComparisonPrompt,
    parseComparisonResponse,
} from "../src/elo-evaluator.js";
import type { Criterion } from "../src/schemas.js";

const baseCriteria: Criterion[] = [
    { name: "correctness", description: "Is it correct?" },
    { name: "clarity", description: "Is it clear?" },
];

describe("buildComparisonPrompt", () => {
    it("includes the task prompt", () => {
        const prompt = buildComparisonPrompt("Build a snake game", "respA", "respB", baseCriteria);
        expect(prompt).toContain("Build a snake game");
    });

    it("includes both responses", () => {
        const prompt = buildComparisonPrompt("task", "Response Alpha", "Response Beta", baseCriteria);
        expect(prompt).toContain("Response Alpha");
        expect(prompt).toContain("Response Beta");
    });

    it("labels responses as A and B", () => {
        const prompt = buildComparisonPrompt("task", "respA", "respB", baseCriteria);
        expect(prompt).toContain("## Response A");
        expect(prompt).toContain("## Response B");
    });

    it("includes all criteria names and descriptions", () => {
        const prompt = buildComparisonPrompt("task", "a", "b", baseCriteria);
        expect(prompt).toContain("correctness");
        expect(prompt).toContain("Is it correct?");
        expect(prompt).toContain("clarity");
        expect(prompt).toContain("Is it clear?");
    });

    it("includes rubric anchors when present", () => {
        const criteria: Criterion[] = [
            {
                name: "code_quality",
                description: "How good is the code?",
                rubric: "90-100: production ready. 0-30: does not compile.",
            },
        ];
        const prompt = buildComparisonPrompt("task", "a", "b", criteria);
        expect(prompt).toContain("Rubric: 90-100: production ready.");
    });

    it("includes responseNote when provided", () => {
        const prompt = buildComparisonPrompt("task", "a", "b", baseCriteria, "Both responses are structured multi-file implementations.");
        expect(prompt).toContain("multi-file implementations");
    });

    it("omits responseNote section when not provided", () => {
        const prompt = buildComparisonPrompt("task", "a", "b", baseCriteria);
        expect(prompt).not.toContain("**Note:**");
    });

    it("includes expected JSON keys in format instructions", () => {
        const prompt = buildComparisonPrompt("task", "a", "b", baseCriteria);
        expect(prompt).toContain('"correctness": "<A, B, or tie>"');
        expect(prompt).toContain('"clarity": "<A, B, or tie>"');
        expect(prompt).toContain('"winner"');
        expect(prompt).toContain('"reasoning"');
    });

    it("asks judge to be decisive", () => {
        const prompt = buildComparisonPrompt("task", "a", "b", baseCriteria);
        expect(prompt).toContain("Be decisive");
    });
});

describe("parseComparisonResponse", () => {
    it("parses clean JSON with winner A", () => {
        const raw = JSON.stringify({
            reasoning: "A is better because...",
            winner: "A",
            criteria: { correctness: "A", clarity: "B" },
        });
        const result = parseComparisonResponse(raw);
        expect(result.reasoning).toBe("A is better because...");
        expect(result.winner).toBe("A");
        expect(result.criteria.correctness).toBe("A");
        expect(result.criteria.clarity).toBe("B");
    });

    it("parses winner B", () => {
        const raw = JSON.stringify({
            reasoning: "B is stronger",
            winner: "B",
            criteria: { correctness: "B" },
        });
        const result = parseComparisonResponse(raw);
        expect(result.winner).toBe("B");
    });

    it("parses tie", () => {
        const raw = JSON.stringify({
            reasoning: "Both are equal",
            winner: "tie",
            criteria: { correctness: "tie" },
        });
        const result = parseComparisonResponse(raw);
        expect(result.winner).toBe("tie");
        expect(result.criteria.correctness).toBe("tie");
    });

    it("normalizes case (lowercase a → A)", () => {
        const raw = JSON.stringify({
            reasoning: "ok",
            winner: "a",
            criteria: { correctness: "b", clarity: "a" },
        });
        const result = parseComparisonResponse(raw);
        expect(result.winner).toBe("A");
        expect(result.criteria.correctness).toBe("B");
        expect(result.criteria.clarity).toBe("A");
    });

    it("treats unknown winner values as tie", () => {
        const raw = JSON.stringify({
            reasoning: "hard to say",
            winner: "draw",
            criteria: {},
        });
        const result = parseComparisonResponse(raw);
        expect(result.winner).toBe("tie");
    });

    it("parses JSON wrapped in markdown fences", () => {
        const raw = `Here is my comparison:
\`\`\`json
{
  "reasoning": "Analysis done",
  "winner": "B",
  "criteria": { "correctness": "A", "clarity": "B" }
}
\`\`\``;
        const result = parseComparisonResponse(raw);
        expect(result.winner).toBe("B");
        expect(result.criteria.correctness).toBe("A");
    });

    it("parses JSON with surrounding text", () => {
        const raw = `After careful comparison:
{
  "reasoning": "Thorough analysis",
  "winner": "A",
  "criteria": { "correctness": "A" }
}
That's my verdict.`;
        const result = parseComparisonResponse(raw);
        expect(result.winner).toBe("A");
        expect(result.reasoning).toBe("Thorough analysis");
    });

    it("handles missing reasoning field", () => {
        const raw = JSON.stringify({
            winner: "A",
            criteria: { correctness: "A" },
        });
        const result = parseComparisonResponse(raw);
        expect(result.reasoning).toBe("");
    });

    it("handles missing criteria field", () => {
        const raw = JSON.stringify({
            reasoning: "Analysis",
            winner: "B",
        });
        const result = parseComparisonResponse(raw);
        expect(result.criteria).toEqual({});
    });

    it("throws if no JSON object found", () => {
        expect(() =>
            parseComparisonResponse("Just some plain text"),
        ).toThrow("No JSON object found");
    });

    it("throws on invalid JSON", () => {
        expect(() =>
            parseComparisonResponse("{ broken json }"),
        ).toThrow();
    });
});
