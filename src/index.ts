import "dotenv/config";
import { resolve } from "path";
import { type RunOptions } from "./schemas.js";
import { loadConfig } from "./config.js";
import { generate } from "./generator.js";
import { evaluate } from "./evaluator.js";
import { aggregate, printLeaderboard, saveResults } from "./aggregator.js";

function parseOptions(args: string[]): RunOptions {
    const tasksIdx = args.indexOf("--tasks");
    const tasks =
        tasksIdx !== -1
            ? args[tasksIdx + 1]?.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined;
    const force = args.includes("--force");
    return { tasks, force };
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
  --tasks <t1,t2,...>   Only run the specified task names (comma-separated)
  --force               Overwrite existing outputs instead of skipping them
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

    switch (command) {
        case "generate":
            await generate(config, rootDir, options);
            break;

        case "evaluate":
            await evaluate(config, rootDir, options);
            break;

        case "report":
            report();
            break;

        case "run":
            await generate(config, rootDir, options);
            await evaluate(config, rootDir, options);
            report();
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
