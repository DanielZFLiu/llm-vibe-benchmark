import { describe, it, expect } from "vitest";
import {
    anonymize,
    buildJudgePrompt,
    parseJudgeResponse,
} from "../src/evaluator.js";
import type { Criterion } from "../src/schemas.js";

describe("anonymize", () => {
    it("strips 'I am an AI trained by' pattern", () => {
        const input = "Hello! I am an AI trained by Anthropic. How can I help?";
        const result = anonymize(input);
        expect(result).toBe("Hello! [REDACTED]. How can I help?");
    });

    it("strips 'I'm an AI made by' pattern", () => {
        const input = "I'm an AI made by OpenAI and I can help you.";
        const result = anonymize(input);
        expect(result).toBe("[REDACTED] and I can help you.");
    });

    it("strips 'I was created by' pattern", () => {
        const input = "I was created by Google to assist users.";
        const result = anonymize(input);
        expect(result).toBe("[REDACTED] to assist users.");
    });

    it("strips 'as an AI assistant built by' pattern", () => {
        const input = "as an AI assistant built by Meta, I should note...";
        const result = anonymize(input);
        expect(result).toBe("[REDACTED], I should note...");
    });

    it("handles multiple identity patterns in one text", () => {
        const input =
            "I am an AI trained by Anthropic. I was developed by Anthropic.";
        const result = anonymize(input);
        expect(result).not.toContain("Anthropic");
        expect(result).toContain("[REDACTED]");
    });

    it("returns text unchanged if no patterns match", () => {
        const input = "Here is a snake game implementation in Python.";
        expect(anonymize(input)).toBe(input);
    });

    it("is case insensitive", () => {
        const input = "I AM AN AI TRAINED BY OPENAI.";
        const result = anonymize(input);
        expect(result).toContain("[REDACTED]");
    });
});

describe("buildJudgePrompt", () => {
    const baseCriteria: Criterion[] = [
        { name: "correctness", description: "Is it correct?" },
        { name: "clarity", description: "Is it clear?" },
    ];

    it("includes the task prompt", () => {
        const prompt = buildJudgePrompt("Build a snake game", "response", baseCriteria);
        expect(prompt).toContain("Build a snake game");
    });

    it("includes the response", () => {
        const prompt = buildJudgePrompt("task", "My snake game code here", baseCriteria);
        expect(prompt).toContain("My snake game code here");
    });

    it("includes all criteria names and descriptions", () => {
        const prompt = buildJudgePrompt("task", "response", baseCriteria);
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
        const prompt = buildJudgePrompt("task", "response", criteria);
        expect(prompt).toContain("Rubric: 90-100: production ready.");
    });

    it("omits rubric line when rubric is not present", () => {
        const prompt = buildJudgePrompt("task", "response", baseCriteria);
        expect(prompt).not.toContain("Rubric:");
    });

    it("includes score keys in JSON format instruction", () => {
        const prompt = buildJudgePrompt("task", "response", baseCriteria);
        expect(prompt).toContain('"correctness": <0-100>');
        expect(prompt).toContain('"clarity": <0-100>');
    });
});

describe("parseJudgeResponse", () => {
    it("parses clean JSON", () => {
        const raw = JSON.stringify({
            reasoning: "Good analysis",
            scores: { correctness: 85, clarity: 90 },
        });
        const result = parseJudgeResponse(raw, "test-judge");
        expect(result.reasoning).toBe("Good analysis");
        expect(result.scores.correctness).toBe(85);
        expect(result.scores.clarity).toBe(90);
    });

    it("parses JSON wrapped in markdown fences", () => {
        const raw = `Here is my evaluation:
\`\`\`json
{
  "reasoning": "Decent work",
  "scores": { "correctness": 70 }
}
\`\`\``;
        const result = parseJudgeResponse(raw, "test-judge");
        expect(result.reasoning).toBe("Decent work");
        expect(result.scores.correctness).toBe(70);
    });

    it("parses JSON with surrounding text", () => {
        const raw = `After careful analysis, here is my evaluation:
{
  "reasoning": "The code works well",
  "scores": { "correctness": 92 }
}
That concludes my review.`;
        const result = parseJudgeResponse(raw, "test-judge");
        expect(result.reasoning).toBe("The code works well");
        expect(result.scores.correctness).toBe(92);
    });

    it("handles missing reasoning field gracefully", () => {
        const raw = JSON.stringify({
            scores: { correctness: 50 },
        });
        const result = parseJudgeResponse(raw, "test-judge");
        expect(result.reasoning).toBe("");
        expect(result.scores.correctness).toBe(50);
    });

    it("handles missing scores field gracefully", () => {
        const raw = JSON.stringify({
            reasoning: "No scores given",
        });
        const result = parseJudgeResponse(raw, "test-judge");
        expect(result.scores).toEqual({});
    });

    it("throws if no JSON object found", () => {
        expect(() =>
            parseJudgeResponse("Just some plain text with no JSON", "judge"),
        ).toThrow("No JSON object found");
    });

    it("throws on invalid JSON", () => {
        expect(() =>
            parseJudgeResponse("{ broken json }", "judge"),
        ).toThrow();
    });

    it("parses fences without json language tag", () => {
        const raw = `\`\`\`
{
  "reasoning": "ok",
  "scores": { "a": 80 }
}
\`\`\``;
        const result = parseJudgeResponse(raw, "judge");
        expect(result.scores.a).toBe(80);
    });
});
