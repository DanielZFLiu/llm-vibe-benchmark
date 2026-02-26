import { existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import type { JudgeScore, ModelStats } from "./schemas.js";

export function aggregate(evaluationsDir: string): ModelStats[] {
    if (!existsSync(evaluationsDir)) {
        console.error("No evaluations found. Run 'evaluate' first.");
        return [];
    }

    // Collect all scores: model -> task -> number[]
    const allScores: Record<string, Record<string, number[]>> = {};

    const taskDirs = readdirSync(evaluationsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

    for (const task of taskDirs) {
        const taskDir = resolve(evaluationsDir, task);
        const files = readdirSync(taskDir).filter((f) => f.endsWith(".json"));

        for (const file of files) {
            // Filename format: modelDir__judgeName.json
            const modelDir = file.split("__")[0]!;
            const filePath = resolve(taskDir, file);

            let judgeScore: JudgeScore;
            try {
                judgeScore = JSON.parse(
                    readFileSync(filePath, "utf-8"),
                );
            } catch {
                console.warn(`  Skipping malformed file: ${filePath}`);
                continue;
            }

            const criterionScores = Object.values(judgeScore.scores);
            if (criterionScores.length === 0) continue;

            const avg =
                criterionScores.reduce((a, b) => a + b, 0) /
                criterionScores.length;

            if (!allScores[modelDir]) allScores[modelDir] = {};
            if (!allScores[modelDir][task]) allScores[modelDir][task] = [];
            allScores[modelDir][task].push(avg);
        }
    }

    // Compute per-model stats
    const stats: ModelStats[] = [];

    for (const [model, tasks] of Object.entries(allScores)) {
        const taskAverages: Record<string, number> = {};
        const allModelScores: number[] = [];

        for (const [task, scores] of Object.entries(tasks)) {
            const taskAvg =
                scores.reduce((a, b) => a + b, 0) / scores.length;
            taskAverages[task] = taskAvg;
            allModelScores.push(taskAvg);
        }

        const avgScore =
            allModelScores.reduce((a, b) => a + b, 0) /
            allModelScores.length;

        // Standard deviation
        const variance =
            allModelScores.reduce(
                (sum, s) => sum + (s - avgScore) ** 2,
                0,
            ) / allModelScores.length;
        const stdDev = Math.sqrt(variance);

        // Best/worst task
        let bestTask = "";
        let bestScore = -1;
        let worstTask = "";
        let worstScore = 101;

        for (const [task, score] of Object.entries(taskAverages)) {
            if (score > bestScore) {
                bestScore = score;
                bestTask = task;
            }
            if (score < worstScore) {
                worstScore = score;
                worstTask = task;
            }
        }

        stats.push({
            model,
            avgScore,
            stdDev,
            bestTask,
            worstTask,
            taskScores: taskAverages,
        });
    }

    // Sort by average score descending
    stats.sort((a, b) => b.avgScore - a.avgScore);
    return stats;
}

export function printLeaderboard(stats: ModelStats[]): void {
    if (stats.length === 0) {
        console.log("No data to display.");
        return;
    }

    console.log("\n=== LLM Vibe Benchmark Leaderboard ===\n");

    // Header
    const header = [
        "Rank",
        "Model",
        "Avg Score",
        "Std Dev",
        "Best Task",
        "Worst Task",
    ];
    const widths = [6, 30, 10, 10, 20, 20];

    const pad = (s: string, w: number) => s.padEnd(w);
    console.log(header.map((h, i) => pad(h, widths[i]!)).join("  "));
    console.log(widths.map((w) => "-".repeat(w)).join("  "));

    for (let i = 0; i < stats.length; i++) {
        const s = stats[i]!;
        const row = [
            `#${i + 1}`,
            s.model,
            s.avgScore.toFixed(1),
            s.stdDev.toFixed(1),
            s.bestTask,
            s.worstTask,
        ];
        console.log(row.map((r, j) => pad(r, widths[j]!)).join("  "));
    }

    // Per-task breakdown
    console.log("\n=== Per-Task Breakdown ===\n");

    const allTasks = [
        ...new Set(stats.flatMap((s) => Object.keys(s.taskScores))),
    ].sort();

    const taskWidths = [30, ...allTasks.map(() => 15)];
    const taskHeader = ["Model", ...allTasks];
    console.log(
        taskHeader.map((h, i) => pad(h, taskWidths[i]!)).join("  "),
    );
    console.log(taskWidths.map((w) => "-".repeat(w)).join("  "));

    for (const s of stats) {
        const row = [
            s.model,
            ...allTasks.map((t) =>
                s.taskScores[t] !== undefined
                    ? s.taskScores[t]!.toFixed(1)
                    : "N/A",
            ),
        ];
        console.log(
            row.map((r, j) => pad(r, taskWidths[j]!)).join("  "),
        );
    }

    console.log("");
}
