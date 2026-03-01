import { existsSync, writeFileSync } from "fs";
import { resolve } from "path";
import { type BenchmarkConfig, type RunOptions } from "./schemas.js";
import { loadTaskConfig } from "./config.js";
import {
    chatCompletion,
    discoverTasks,
    readPrompt,
    ensureDir,
    withRetry,
    sanitizeModelName,
    runConcurrent,
} from "./utils.js";
import { ProgressBar } from "./progress.js";

export async function generate(
    config: BenchmarkConfig,
    rootDir: string,
    options?: RunOptions,
): Promise<void> {
    const tasksDir = resolve(rootDir, config.tasksDir);
    const responsesDir = resolve(rootDir, config.responsesDir);
    let tasks = discoverTasks(tasksDir);

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

    let models = config.setC;
    if (options?.models) {
        const patterns = options.models.map((m) => m.toLowerCase());
        models = models.filter((m) =>
            patterns.some((p) => m.toLowerCase().includes(p)),
        );
        if (models.length === 0) {
            console.error(
                `No models matched: ${options.models.join(", ")}`,
            );
            return;
        }
    }

    const total = models.length * tasks.length;
    console.log(
        `\nGenerating responses: ${models.length} models × ${tasks.length} tasks = ${total} calls\n`,
    );

    const progress = new ProgressBar(total);
    let completed = 0;
    let skipped = 0;

    const queue: { model: string; task: string }[] = [];
    for (const model of models) {
        for (const task of tasks) {
            queue.push({ model, task });
        }
    }

    await runConcurrent(
        queue,
        config.maxConcurrency,
        async ({ model, task }) => {
            const modelDir = resolve(responsesDir, sanitizeModelName(model));
            const outputPath = resolve(modelDir, `${task}.md`);

            if (!options?.force && existsSync(outputPath)) {
                skipped++;
                progress.skip();
                progress.log(`  [skip] ${model} / ${task} (already exists)`);
                return;
            }

            progress.start();
            const prompt = readPrompt(tasksDir, task);
            const taskConfig = loadTaskConfig(resolve(tasksDir, task));
            const effectiveMaxTokens =
                taskConfig?.maxTokens ?? config.maxTokens;
            const messages: { role: "system" | "user"; content: string }[] = [];
            if (taskConfig?.systemPrompt) {
                messages.push({
                    role: "system",
                    content: taskConfig.systemPrompt,
                });
            }
            messages.push({ role: "user", content: prompt });

            try {
                const response = await withRetry(
                    () => chatCompletion(model, messages, effectiveMaxTokens),
                    3,
                    2000,
                    (msg) => progress.log(msg),
                );

                ensureDir(modelDir);
                writeFileSync(outputPath, response, "utf-8");
                completed++;
                progress.succeed();
                progress.log(
                    `  [done] ${model} / ${task} (${completed + skipped}/${total})`,
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                progress.fail();
                progress.log(`  [FAIL] ${model} / ${task}: ${msg}`);
            }
        },
    );

    progress.finish();
    console.log(
        `\nGeneration complete: ${completed} generated, ${skipped} skipped, ${total - completed - skipped} failed`,
    );
}
