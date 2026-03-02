import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve } from "path";
import {
    type BenchmarkConfig,
    type Criterion,
    type EloComparison,
    type RunOptions,
    EloComparisonSchema,
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
import { anonymize } from "./evaluator.js";
import { ProgressBar } from "./progress.js";

export function buildComparisonPrompt(
    taskPrompt: string,
    responseA: string,
    responseB: string,
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

    const criteriaKeys = criteria
        .map((c) => `"${c.name}": "<A, B, or tie>"`)
        .join(", ");

    const note = responseNote
        ? `> **Note:** Both responses are structured multi-file implementations. Evaluate them holistically across all provided files.\n\n`
        : "";

    return `You are an expert judge comparing two LLM responses to the same task. Your job is to determine which response is better.

## Task Prompt
${taskPrompt}

${note}## Response A
${responseA}

## Response B
${responseB}

## Evaluation Criteria
For each criterion, determine which response is better (A, B, or tie):
${criteriaBlock}

## Instructions
1. Analyze both responses carefully against each criterion.
2. For each criterion, decide which response is stronger (A, B, or tie).
3. Determine the overall winner based on your analysis.
4. Be decisive — only call a tie when the responses are genuinely equal on a criterion.

Respond in EXACTLY this JSON format (no markdown fences, no extra text after the JSON):
{
  "reasoning": "<your comparative analysis of both responses>",
  "winner": "<A or B or tie>",
  "criteria": { ${criteriaKeys} }
}`;
}

export function parseComparisonResponse(
    raw: string,
): { reasoning: string; winner: "A" | "B" | "tie"; criteria: Record<string, "A" | "B" | "tie"> } {
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        jsonStr = fenceMatch[1]!.trim();
    }

    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objMatch) {
        throw new Error("No JSON object found in judge comparison response");
    }

    const parsed = JSON.parse(objMatch[0]);
    const winner = parsed.winner?.toUpperCase?.() === "A" ? "A"
        : parsed.winner?.toUpperCase?.() === "B" ? "B"
        : "tie";

    const criteria: Record<string, "A" | "B" | "tie"> = {};
    if (parsed.criteria && typeof parsed.criteria === "object") {
        for (const [key, val] of Object.entries(parsed.criteria)) {
            const v = String(val).toUpperCase();
            criteria[key] = v === "A" ? "A" : v === "B" ? "B" : "tie";
        }
    }

    return {
        reasoning: parsed.reasoning ?? "",
        winner,
        criteria,
    };
}

function getResponseModels(responsesDir: string): string[] {
    if (!existsSync(responsesDir)) return [];
    return readdirSync(responsesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
}

/** Generate all unique pairs from an array. */
function pairs<T>(arr: T[]): [T, T][] {
    const result: [T, T][] = [];
    for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
            result.push([arr[i]!, arr[j]!]);
        }
    }
    return result;
}

export async function eloEvaluate(
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
            console.warn(
                `  Warning: tasks not found and will be skipped: ${notFound.join(", ")}`,
            );
        }
        tasks = tasks.filter((t) => options.tasks!.includes(t));
        if (tasks.length === 0) {
            console.error("No valid tasks to run after filtering.");
            return;
        }
    }

    let filteredModelDirs = modelDirs;
    if (options?.models) {
        const patterns = options.models.map((m) => m.toLowerCase());
        filteredModelDirs = modelDirs.filter((d) =>
            patterns.some((p) => d.toLowerCase().includes(p)),
        );
        if (filteredModelDirs.length === 0) {
            console.error(
                `No response models matched: ${options.models.join(", ")}`,
            );
            return;
        }
    }

    if (filteredModelDirs.length < 2) {
        console.error("Need at least 2 models for ELO pairwise comparison.");
        return;
    }

    const modelPairs = pairs(filteredModelDirs);

    // Build work queue: task × model-pair × judge
    const queue: {
        task: string;
        modelDirA: string;
        modelDirB: string;
        judge: string;
    }[] = [];

    for (const task of tasks) {
        for (const [modelDirA, modelDirB] of modelPairs) {
            const responsePathA = resolve(responsesDir, modelDirA, `${task}.md`);
            const responsePathB = resolve(responsesDir, modelDirB, `${task}.md`);
            if (!existsSync(responsePathA) || !existsSync(responsePathB))
                continue;

            for (const judge of config.setJ) {
                queue.push({ task, modelDirA, modelDirB, judge });
            }
        }
    }

    const total = queue.length;
    const pairCount = modelPairs.length;
    console.log(
        `\nELO Evaluation: ${tasks.length} tasks × ${pairCount} pairs × ${config.setJ.length} judges = ${total} comparisons\n`,
    );

    const progress = new ProgressBar(total);
    let completed = 0;
    let skipped = 0;

    await runConcurrent(
        queue,
        config.maxConcurrency,
        async ({ task, modelDirA, modelDirB, judge }) => {
            const eloDir = resolve(evaluationsDir, task, "elo");
            const filename = `${modelDirA}__vs__${modelDirB}__${sanitizeModelName(judge)}.json`;
            const evalPath = resolve(eloDir, filename);

            if (!options?.force && existsSync(evalPath)) {
                skipped++;
                progress.skip();
                progress.log(
                    `  [skip] ${task} / ${modelDirA} vs ${modelDirB} / ${judge} (already exists)`,
                );
                return;
            }

            progress.start();

            const taskPrompt = readFileSync(
                resolve(tasksDir, task, "prompt.txt"),
                "utf-8",
            ).trim();
            const criteria = loadTaskCriteria(resolve(tasksDir, task));
            const taskConfig = loadTaskConfig(resolve(tasksDir, task));

            const rawA = readFileSync(
                resolve(responsesDir, modelDirA, `${task}.md`),
                "utf-8",
            );
            const rawB = readFileSync(
                resolve(responsesDir, modelDirB, `${task}.md`),
                "utf-8",
            );

            const responseA = anonymize(rawA);
            const responseB = anonymize(rawB);

            // Randomly swap positions to mitigate position bias
            const swapped = Math.random() < 0.5;
            const shownA = swapped ? responseB : responseA;
            const shownB = swapped ? responseA : responseB;

            const responseNote = taskConfig?.systemPrompt
                ? "Both responses are structured multi-file implementations."
                : undefined;

            const prompt = buildComparisonPrompt(
                taskPrompt,
                shownA,
                shownB,
                criteria,
                responseNote,
            );

            try {
                const judgeRaw = await withRetry(
                    async () => {
                        const result = await chatCompletion(judge, [
                            { role: "user", content: prompt },
                        ]);
                        parseComparisonResponse(result);
                        return result;
                    },
                    3,
                    2000,
                    (msg) => progress.log(msg),
                );

                const parsed = parseComparisonResponse(judgeRaw);

                // Un-swap: translate the judge's verdict back to the real models
                let realWinner: "A" | "B" | "tie" = parsed.winner;
                if (swapped && realWinner !== "tie") {
                    realWinner = realWinner === "A" ? "B" : "A";
                }
                const realCriteria: Record<string, "A" | "B" | "tie"> = {};
                for (const [key, val] of Object.entries(parsed.criteria)) {
                    if (swapped && val !== "tie") {
                        realCriteria[key] = val === "A" ? "B" : "A";
                    } else {
                        realCriteria[key] = val;
                    }
                }

                const comparison: EloComparison = {
                    judge,
                    modelA: modelDirA.replace(/__/, "/"),
                    modelB: modelDirB.replace(/__/, "/"),
                    winner: realWinner,
                    criterionWinners: realCriteria,
                    reasoning: parsed.reasoning,
                };

                EloComparisonSchema.parse(comparison);

                ensureDir(eloDir);
                writeFileSync(
                    evalPath,
                    JSON.stringify(comparison, null, 2),
                    "utf-8",
                );
                completed++;
                progress.succeed();
                progress.log(
                    `  [done] ${task} / ${modelDirA} vs ${modelDirB} / ${judge} → ${realWinner} (${completed + skipped}/${total})`,
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                progress.fail();
                progress.log(
                    `  [FAIL] ${task} / ${modelDirA} vs ${modelDirB} / ${judge}: ${msg}`,
                );
            }
        },
    );

    progress.finish();
    console.log(
        `\nELO evaluation complete: ${completed} compared, ${skipped} skipped, ${total - completed - skipped} failed`,
    );
}
