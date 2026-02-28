import { resolve } from "path";
import { loadConfig } from "./config.js";
import { generate } from "./generator.js";
import { evaluate } from "./evaluator.js";
import { aggregate, printLeaderboard, saveResults } from "./aggregator.js";

async function main(): Promise<void> {
    const command = process.argv[2];
    const rootDir = process.cwd();

    if (!command || command === "help" || command === "--help") {
        console.log(`
Usage: llm-vibe-benchmark <command>

Commands:
  generate   Generate responses from Set C models for all tasks
  evaluate   Have Set J judges score all responses
  report     Aggregate scores and print the leaderboard
  run        Run all steps: generate → evaluate → report
`);
        return;
    }

    const config = loadConfig(rootDir);

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
            await generate(config, rootDir);
            break;

        case "evaluate":
            await evaluate(config, rootDir);
            break;

        case "report":
            report();
            break;

        case "run":
            await generate(config, rootDir);
            await evaluate(config, rootDir);
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
