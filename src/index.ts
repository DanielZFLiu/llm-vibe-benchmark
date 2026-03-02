import "dotenv/config";
import { resolve } from "path";
import { type RunOptions } from "./schemas.js";
import { loadConfig } from "./config.js";
import { generate } from "./generator.js";
import { evaluate } from "./evaluator.js";
import { aggregate, printLeaderboard, saveResults } from "./aggregator.js";
import { eloEvaluate } from "./elo-evaluator.js";
import {
    eloAggregate,
    printEloLeaderboard,
    saveEloResults,
} from "./elo-aggregator.js";

function parseOptions(args: string[]): RunOptions {
    const tasksIdx = args.indexOf("--tasks");
    const tasks =
        tasksIdx !== -1
            ? args[tasksIdx + 1]?.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined;
    const modelsIdx = args.indexOf("--models");
    const models =
        modelsIdx !== -1
            ? args[modelsIdx + 1]?.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined;
    const force = args.includes("--force");
    const elo = args.includes("--elo");
    return { tasks, models, force, elo };
}

async function main(): Promise<void> {
    const command = process.argv[2];
    const rootDir = process.cwd();

    if (!command || command === "help" || command === "--help") {
        console.log(`
Usage: llm-vibe-benchmark <command> [options]

Commands:
  generate   Generate responses from Set C models for all tasks
  evaluate   Have Set J judges score all responses
  report     Aggregate scores and print the leaderboard
  run        Run all steps: generate → evaluate → report

Options:
  --tasks <t1,t2,...>    Only run the specified task names (comma-separated)
  --models <m1,m2,...>   Only run the specified Set C models (comma-separated, partial match)
  --force                Overwrite existing outputs instead of skipping them
  --elo                  Use ELO pairwise comparison mode instead of absolute scoring
`);
        return;
    }

    const config = loadConfig(rootDir);
    const options = parseOptions(process.argv.slice(3));

    const report = () => {
        const evaluationsDir = resolve(rootDir, config.evaluationsDir);
        const stats = aggregate(evaluationsDir);
        printLeaderboard(stats);
        if (stats.length > 0) {
            saveResults(stats, resolve(evaluationsDir, "results.json"));
        }
    };

    const eloReport = () => {
        const evaluationsDir = resolve(rootDir, config.evaluationsDir);
        const results = eloAggregate(evaluationsDir);
        printEloLeaderboard(results);
        if (results.models.length > 0) {
            saveEloResults(
                results,
                resolve(evaluationsDir, "elo-results.json"),
            );
        }
    };

    switch (command) {
        case "generate":
            await generate(config, rootDir, options);
            break;

        case "evaluate":
            if (options.elo) {
                await eloEvaluate(config, rootDir, options);
            } else {
                await evaluate(config, rootDir, options);
            }
            break;

        case "report":
            if (options.elo) {
                eloReport();
            } else {
                report();
            }
            break;

        case "run":
            await generate(config, rootDir, options);
            if (options.elo) {
                await eloEvaluate(config, rootDir, options);
                eloReport();
            } else {
                await evaluate(config, rootDir, options);
                report();
            }
            break;

        default:
            console.error(`Unknown command: ${command}`);
            console.error("Run with 'help' to see available commands.");
            process.exit(1);
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
