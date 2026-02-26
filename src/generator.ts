import { existsSync, writeFileSync } from "fs";
import { resolve } from "path";
import { type BenchmarkConfig } from "./schemas.js";
import {
    chatCompletion,
    discoverTasks,
    readPrompt,
    ensureDir,
    withRetry,
    sanitizeModelName,
    runConcurrent,
} from "./utils.js";

export async function generate(
    config: BenchmarkConfig,
    rootDir: string,
): Promise<void> {
    const tasksDir = resolve(rootDir, config.tasksDir);
    const responsesDir = resolve(rootDir, config.responsesDir);
    const tasks = discoverTasks(tasksDir);

    const total = config.setC.length * tasks.length;
    console.log(
        `\nGenerating responses: ${config.setC.length} models × ${tasks.length} tasks = ${total} calls\n`,
    );

    let completed = 0;
    let skipped = 0;

    const queue: { model: string; task: string }[] = [];
    for (const model of config.setC) {
        for (const task of tasks) {
            queue.push({ model, task });
        }
    }

    await runConcurrent(queue, config.maxConcurrency, async ({ model, task }) => {
        const modelDir = resolve(responsesDir, sanitizeModelName(model));
        const outputPath = resolve(modelDir, `${task}.md`);

        if (existsSync(outputPath)) {
            skipped++;
            console.log(`  [skip] ${model} / ${task} (already exists)`);
            return;
        }

        const prompt = readPrompt(tasksDir, task);

        try {
            const response = await withRetry(() =>
                chatCompletion(model, [
                    { role: "user", content: prompt },
                ]),
            );

            ensureDir(modelDir);
            writeFileSync(outputPath, response, "utf-8");
            completed++;
            console.log(
                `  [done] ${model} / ${task} (${completed + skipped}/${total})`,
            );
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : String(err);
            console.error(`  [FAIL] ${model} / ${task}: ${msg}`);
        }
    });

    console.log(
        `\nGeneration complete: ${completed} generated, ${skipped} skipped, ${total - completed - skipped} failed`,
    );
}
