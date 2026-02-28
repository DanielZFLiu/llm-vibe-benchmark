import { z } from "zod";

// --- Benchmark Config Schemas ---

export const BenchmarkConfigSchema = z.object({
    setC: z.array(z.string()).min(1, "At least one competitor model required"),
    setJ: z.array(z.string()).min(1, "At least one judge model required"),
    tasksDir: z.string().default("./tasks"),
    responsesDir: z.string().default("./responses"),
    evaluationsDir: z.string().default("./evaluations"),
    maxConcurrency: z.number().int().positive().default(3),
});

export type BenchmarkConfig = z.infer<typeof BenchmarkConfigSchema>;

// --- Task Criteria Schemas ---

export const CriterionSchema = z.object({
    name: z.string(),
    description: z.string(),
    rubric: z.string().optional(),
});

export type Criterion = z.infer<typeof CriterionSchema>;

export const TaskCriteriaSchema = z.object({
    criteria: z
        .array(CriterionSchema)
        .min(1, "At least one criterion required"),
});

export type TaskCriteria = z.infer<typeof TaskCriteriaSchema>;

// --- Judge Evaluation Output Schemas ---

export const JudgeScoreSchema = z.object({
    judge: z.string(),
    reasoning: z.string(),
    scores: z.record(z.string(), z.number().min(0).max(100)),
});

export type JudgeScore = z.infer<typeof JudgeScoreSchema>;

export const EvaluationResultSchema = z.object({
    task: z.string(),
    model: z.string(),
    scores: z.array(JudgeScoreSchema),
    average: z.number(),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// --- CLI Run Options ---

export interface RunOptions {
    tasks?: string[];
    force?: boolean;
}

// --- Aggregator Types ---

export interface ModelStats {
    model: string;
    avgScore: number;
    stdDev: number;
    bestTask: string;
    worstTask: string;
    taskScores: Record<string, number>;
}

// --- Default Criteria ---

export const DEFAULT_CRITERIA: Criterion[] = [
    {
        name: "completeness",
        description: "Does the response fully address the task?",
    },
    {
        name: "richness",
        description:
            "Does it explain reasoning, trade-offs, or how to use the result?",
    },
    {
        name: "organization",
        description:
            "Is the output well-structured, clear, and easy to follow?",
    },
    {
        name: "best_practices",
        description:
            "Does it follow modern conventions relevant to the domain?",
    },
];
