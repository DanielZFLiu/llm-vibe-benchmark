import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve } from "path";
import {
    type BenchmarkConfig,
    type Criterion,
    type JudgeScore,
    type RunOptions,
    JudgeScoreSchema,
} from "./schemas.js";
import { loadTaskCriteria, loadTaskConfig } from "./config.js";
import {
    chatCompletion,
    discoverTasks,
    ensureDir,
    withRetry,
    sanitizeModelName,
    runConcurrent,
} from "./utils.js";

const IDENTITY_PATTERNS = [
    /I('m| am) (an AI|a language model|an assistant) (made|trained|created|developed|built) by \w+/gi,
    /as an AI (language model|assistant) (made|trained|created|developed|built) by \w+/gi,
    /I was (made|trained|created|developed|built) by \w+/gi,
];

export function anonymize(text: string): string {
    let result = text;
    for (const pattern of IDENTITY_PATTERNS) {
        result = result.replace(pattern, "[REDACTED]");
    }
    return result;
}

export function buildJudgePrompt(
    taskPrompt: string,
    response: string,
    criteria: Criterion[],
    responseNote?: string,
): string {
    const criteriaBlock = criteria
        .map((c) => {
            let line = `- **${c.name}**: ${c.description}`;
            if (c.rubric) {
                line += `\n  Rubric: ${c.rubric}`;
            }
            return line;
        })
        .join("\n");

    const scoreKeys = criteria.map((c) => `"${c.name}": <0-100>`).join(", ");

    return `You are an expert judge evaluating an LLM's response to a task.

## Task Prompt
${taskPrompt}

## Response to Evaluate
${responseNote ? `> **Note:** ${responseNote}\n\n` : ""}${response}

## Evaluation Criteria
Score each criterion from 0 to 100:
${criteriaBlock}

## Instructions
1. First, provide your reasoning analyzing the response against each criterion.
2. Then, provide your scores as JSON.

Respond in EXACTLY this JSON format (no markdown fences, no extra text after the JSON):
{
  "reasoning": "<your chain-of-thought analysis>",
  "scores": { ${scoreKeys} }
}`;
}

export function parseJudgeResponse(
    raw: string,
    judgeName: string,
): { reasoning: string; scores: Record<string, number> } {
    // Try to extract JSON from the response (handle markdown fences)
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        jsonStr = fenceMatch[1]!.trim();
    }

    // Try to find a JSON object in the response
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objMatch) {
        throw new Error(`No JSON object found in judge response`);
    }

    const parsed = JSON.parse(objMatch[0]);
    return {
        reasoning: parsed.reasoning ?? "",
        scores: parsed.scores ?? {},
    };
}

function getResponseModels(responsesDir: string): string[] {
    if (!existsSync(responsesDir)) return [];
    return readdirSync(responsesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
}

export async function evaluate(
    config: BenchmarkConfig,
    rootDir: string,
    options?: RunOptions,
): Promise<void> {
    const tasksDir = resolve(rootDir, config.tasksDir);
    const responsesDir = resolve(rootDir, config.responsesDir);
    const evaluationsDir = resolve(rootDir, config.evaluationsDir);
    let tasks = discoverTasks(tasksDir);
    const modelDirs = getResponseModels(responsesDir);

    if (options?.tasks) {
        const notFound = options.tasks.filter((t) => !tasks.includes(t));
        if (notFound.length > 0) {
            console.warn(`  Warning: tasks not found and will be skipped: ${notFound.join(", ")}`);
        }
        tasks = tasks.filter((t) => options.tasks!.includes(t));
        if (tasks.length === 0) {
            console.error("No valid tasks to run after filtering.");
            return;
        }
    }

    if (modelDirs.length === 0) {
        console.error("No responses found. Run 'generate' first.");
        return;
    }

    // Build work queue: task × model × judge
    const queue: { task: string; modelDir: string; judge: string }[] = [];
    for (const task of tasks) {
        for (const modelDir of modelDirs) {
            const responsePath = resolve(responsesDir, modelDir, `${task}.md`);
            if (!existsSync(responsePath)) continue;

            for (const judge of config.setJ) {
                queue.push({ task, modelDir, judge });
            }
        }
    }

    const total = queue.length;
    console.log(
        `\nEvaluating: ${tasks.length} tasks × ${modelDirs.length} models × ${config.setJ.length} judges = ${total} calls\n`,
    );

    let completed = 0;
    let skipped = 0;

    await runConcurrent(queue, config.maxConcurrency, async ({ task, modelDir, judge }) => {
        const evalDir = resolve(evaluationsDir, task);
        const evalPath = resolve(
            evalDir,
            `${modelDir}__${sanitizeModelName(judge)}.json`,
        );

        if (!options?.force && existsSync(evalPath)) {
            skipped++;
            console.log(
                `  [skip] ${task} / ${modelDir} / ${judge} (already exists)`,
            );
            return;
        }

        const taskPrompt = readFileSync(
            resolve(tasksDir, task, "prompt.txt"),
            "utf-8",
        ).trim();
        const criteria = loadTaskCriteria(resolve(tasksDir, task));
        const taskConfig = loadTaskConfig(resolve(tasksDir, task));
        const rawResponse = readFileSync(
            resolve(responsesDir, modelDir, `${task}.md`),
            "utf-8",
        );
        const response = anonymize(rawResponse);
        const responseNote = taskConfig?.systemPrompt
            ? "This is a structured multi-file implementation. Evaluate the response holistically across all provided files."
            : undefined;

        const judgePrompt = buildJudgePrompt(
            taskPrompt,
            response,
            criteria,
            responseNote,
        );

        try {
            const judgeRaw = await withRetry(async () => {
                const result = await chatCompletion(judge, [
                    { role: "user", content: judgePrompt },
                ]);
                // Validate parse-ability inside retry loop
                parseJudgeResponse(result, judge);
                return result;
            });

            const parsed = parseJudgeResponse(judgeRaw, judge);

            const judgeScore: JudgeScore = {
                judge,
                reasoning: parsed.reasoning,
                scores: parsed.scores,
            };

            // Validate with Zod
            JudgeScoreSchema.parse(judgeScore);

            ensureDir(evalDir);
            writeFileSync(
                evalPath,
                JSON.stringify(judgeScore, null, 2),
                "utf-8",
            );
            completed++;
            console.log(
                `  [done] ${task} / ${modelDir} / ${judge} (${completed + skipped}/${total})`,
            );
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : String(err);
            console.error(
                `  [FAIL] ${task} / ${modelDir} / ${judge}: ${msg}`,
            );
        }
    });

    console.log(
        `\nEvaluation complete: ${completed} evaluated, ${skipped} skipped, ${total - completed - skipped} failed`,
    );
}
