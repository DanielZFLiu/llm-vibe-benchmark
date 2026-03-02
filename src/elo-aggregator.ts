import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import type {
    EloComparison,
    EloModelStats,
    EloMatchup,
    EloResults,
} from "./schemas.js";

const INITIAL_ELO = 1500;
const K_FACTOR = 32;
const CONVERGENCE_PASSES = 50;

interface MatchResult {
    modelA: string;
    modelB: string;
    winner: "A" | "B" | "tie";
    task: string;
}

/** Read all elo comparison files from evaluations/<task>/elo/ directories. */
function collectMatches(evaluationsDir: string): MatchResult[] {
    if (!existsSync(evaluationsDir)) return [];

    const results: MatchResult[] = [];
    const taskDirs = readdirSync(evaluationsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

    for (const task of taskDirs) {
        const eloDir = resolve(evaluationsDir, task, "elo");
        if (!existsSync(eloDir)) continue;

        const files = readdirSync(eloDir).filter((f) => f.endsWith(".json"));

        for (const file of files) {
            try {
                const raw: EloComparison = JSON.parse(
                    readFileSync(resolve(eloDir, file), "utf-8"),
                );
                // Extract modelDir names from the filename
                // Format: modelA__vs__modelB__judgeDir.json
                const base = file.replace(/\.json$/, "");
                const vsIdx = base.indexOf("__vs__");
                if (vsIdx === -1) continue;

                const modelDirA = base.substring(0, vsIdx);
                // After __vs__, the rest is modelB__judgeDir
                // We need to find where modelB ends and judge starts
                // modelB is provider__model, judge is also provider__model
                // So we need to split the remainder by __ and take first 2 parts as modelB
                const afterVs = base.substring(vsIdx + 6); // skip "__vs__"
                const parts = afterVs.split("__");
                // modelB = parts[0]__parts[1], judge = rest
                if (parts.length < 4) continue;
                const modelDirB = parts[0] + "__" + parts[1];

                results.push({
                    modelA: modelDirA,
                    modelB: modelDirB,
                    winner: raw.winner,
                    task,
                });
            } catch {
                // skip malformed files
            }
        }
    }

    return results;
}

/** Compute ELO ratings from a list of match results. */
function computeElo(
    matches: MatchResult[],
): Map<string, number> {
    const ratings = new Map<string, number>();

    // Discover all models
    for (const m of matches) {
        if (!ratings.has(m.modelA)) ratings.set(m.modelA, INITIAL_ELO);
        if (!ratings.has(m.modelB)) ratings.set(m.modelB, INITIAL_ELO);
    }

    // Count matches per model for delta normalization
    const matchCounts = new Map<string, number>();
    for (const m of matches) {
        matchCounts.set(m.modelA, (matchCounts.get(m.modelA) ?? 0) + 1);
        matchCounts.set(m.modelB, (matchCounts.get(m.modelB) ?? 0) + 1);
    }

    // Multiple passes for convergence using batch updates (order-independent)
    for (let pass = 0; pass < CONVERGENCE_PASSES; pass++) {
        const deltas = new Map<string, number>();
        for (const model of ratings.keys()) {
            deltas.set(model, 0);
        }

        for (const match of matches) {
            const rA = ratings.get(match.modelA)!;
            const rB = ratings.get(match.modelB)!;

            const expectedA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
            const expectedB = 1 - expectedA;

            let scoreA: number;
            let scoreB: number;
            if (match.winner === "A") {
                scoreA = 1;
                scoreB = 0;
            } else if (match.winner === "B") {
                scoreA = 0;
                scoreB = 1;
            } else {
                scoreA = 0.5;
                scoreB = 0.5;
            }

            deltas.set(match.modelA, deltas.get(match.modelA)! + K_FACTOR * (scoreA - expectedA));
            deltas.set(match.modelB, deltas.get(match.modelB)! + K_FACTOR * (scoreB - expectedB));
        }

        // Apply all deltas simultaneously so match order doesn't matter
        // Normalize by match count to keep the effective step size at K per model
        for (const [model, delta] of deltas) {
            const count = matchCounts.get(model) ?? 1;
            ratings.set(model, ratings.get(model)! + delta / count);
        }
    }

    return ratings;
}

/** Scale ELO ratings linearly to 0-100 (min-max normalization). */
function scaleElo(ratings: Map<string, number>): Map<string, number> {
    const values = [...ratings.values()];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;

    const scaled = new Map<string, number>();
    for (const [model, elo] of ratings) {
        scaled.set(model, range > 0 ? ((elo - min) / range) * 100 : 50);
    }
    return scaled;
}

/** Compute head-to-head matchup records. */
function computeMatchups(matches: MatchResult[]): EloMatchup[] {
    const key = (a: string, b: string) => a < b ? `${a}||${b}` : `${b}||${a}`;
    const records = new Map<string, { modelA: string; modelB: string; winsA: number; winsB: number; ties: number }>();

    for (const match of matches) {
        const k = key(match.modelA, match.modelB);
        if (!records.has(k)) {
            const [first, second] = match.modelA < match.modelB
                ? [match.modelA, match.modelB]
                : [match.modelB, match.modelA];
            records.set(k, { modelA: first, modelB: second, winsA: 0, winsB: 0, ties: 0 });
        }
        const rec = records.get(k)!;

        if (match.winner === "tie") {
            rec.ties++;
        } else {
            // Determine which side won relative to the canonical order
            const actualWinner = match.winner === "A" ? match.modelA : match.modelB;
            if (actualWinner === rec.modelA) {
                rec.winsA++;
            } else {
                rec.winsB++;
            }
        }
    }

    return [...records.values()].sort((a, b) => a.modelA.localeCompare(b.modelA));
}

/** Aggregate ELO results from comparison files. */
export function eloAggregate(evaluationsDir: string): EloResults {
    const matches = collectMatches(evaluationsDir);

    if (matches.length === 0) {
        return { models: [], matchups: [] };
    }

    // Global ELO
    const globalRatings = computeElo(matches);
    const globalScaled = scaleElo(globalRatings);

    // Per-task ELO
    const taskMatches = new Map<string, MatchResult[]>();
    for (const m of matches) {
        if (!taskMatches.has(m.task)) taskMatches.set(m.task, []);
        taskMatches.get(m.task)!.push(m);
    }
    const perTaskElo = new Map<string, Map<string, number>>();
    for (const [task, tMatches] of taskMatches) {
        perTaskElo.set(task, computeElo(tMatches));
    }

    // Win/loss/tie records
    const wins = new Map<string, number>();
    const losses = new Map<string, number>();
    const ties = new Map<string, number>();
    for (const model of globalRatings.keys()) {
        wins.set(model, 0);
        losses.set(model, 0);
        ties.set(model, 0);
    }
    for (const match of matches) {
        if (match.winner === "tie") {
            ties.set(match.modelA, (ties.get(match.modelA) ?? 0) + 1);
            ties.set(match.modelB, (ties.get(match.modelB) ?? 0) + 1);
        } else if (match.winner === "A") {
            wins.set(match.modelA, (wins.get(match.modelA) ?? 0) + 1);
            losses.set(match.modelB, (losses.get(match.modelB) ?? 0) + 1);
        } else {
            wins.set(match.modelB, (wins.get(match.modelB) ?? 0) + 1);
            losses.set(match.modelA, (losses.get(match.modelA) ?? 0) + 1);
        }
    }

    // Build model stats
    const models: EloModelStats[] = [];
    for (const [model, elo] of globalRatings) {
        const taskElos: Record<string, number> = {};
        for (const [task, ratings] of perTaskElo) {
            const taskRating = ratings.get(model);
            if (taskRating !== undefined) taskElos[task] = Math.round(taskRating);
        }

        models.push({
            model,
            elo: Math.round(elo),
            scaled: Math.round(globalScaled.get(model)! * 10) / 10,
            wins: wins.get(model) ?? 0,
            losses: losses.get(model) ?? 0,
            ties: ties.get(model) ?? 0,
            taskElos,
        });
    }

    // Sort by ELO descending
    models.sort((a, b) => b.elo - a.elo);

    const matchups = computeMatchups(matches);

    return { models, matchups };
}

/** Print ELO leaderboard to console. */
export function printEloLeaderboard(results: EloResults): void {
    if (results.models.length === 0) {
        console.log("No ELO data to display. Run 'evaluate --elo' first.");
        return;
    }

    console.log("\n=== ELO Rankings ===\n");

    const header = ["Rank", "Model", "ELO", "Score", "W", "L", "T"];
    const widths = [6, 30, 8, 8, 5, 5, 5];
    const pad = (s: string, w: number) => s.padEnd(w);

    console.log(header.map((h, i) => pad(h, widths[i]!)).join("  "));
    console.log(widths.map((w) => "-".repeat(w)).join("  "));

    for (let i = 0; i < results.models.length; i++) {
        const m = results.models[i]!;
        const row = [
            `#${i + 1}`,
            m.model,
            String(m.elo),
            m.scaled.toFixed(1),
            String(m.wins),
            String(m.losses),
            String(m.ties),
        ];
        console.log(row.map((r, j) => pad(r, widths[j]!)).join("  "));
    }

    // Per-task ELO breakdown
    const allTasks = [
        ...new Set(results.models.flatMap((m) => Object.keys(m.taskElos))),
    ].sort();

    if (allTasks.length > 0) {
        console.log("\n=== Per-Task ELO ===\n");

        const taskWidths = [
            Math.max(30, ...results.models.map((m) => m.model.length)),
            ...allTasks.map((t) => Math.max(15, t.length)),
        ];
        const taskHeader = ["Model", ...allTasks];
        console.log(taskHeader.map((h, i) => pad(h, taskWidths[i]!)).join("  "));
        console.log(taskWidths.map((w) => "-".repeat(w)).join("  "));

        for (const m of results.models) {
            const row = [
                m.model,
                ...allTasks.map((t) =>
                    m.taskElos[t] !== undefined ? String(m.taskElos[t]) : "N/A",
                ),
            ];
            console.log(row.map((r, j) => pad(r, taskWidths[j]!)).join("  "));
        }
    }

    // Head-to-head matrix
    if (results.matchups.length > 0) {
        console.log("\n=== Head-to-Head ===\n");

        const modelNames = results.models.map((m) => m.model);
        const nameWidth = Math.max(20, ...modelNames.map((n) => n.length)) + 2;
        const cellWidth = Math.max(10, ...modelNames.map((n) => n.length));

        // Header row
        const hdrRow = pad("", nameWidth) + modelNames.map((n) => pad(n.substring(0, cellWidth), cellWidth)).join("  ");
        console.log(hdrRow);
        console.log("-".repeat(hdrRow.length));

        // Build lookup
        const matchupLookup = new Map<string, EloMatchup>();
        for (const mu of results.matchups) {
            matchupLookup.set(`${mu.modelA}||${mu.modelB}`, mu);
            matchupLookup.set(`${mu.modelB}||${mu.modelA}`, mu);
        }

        for (const rowModel of modelNames) {
            const cells = modelNames.map((colModel) => {
                if (rowModel === colModel) return pad("--", cellWidth);

                const key = `${rowModel}||${colModel}`;
                const mu = matchupLookup.get(key);
                if (!mu) return pad("--", cellWidth);

                // Figure out wins for rowModel vs colModel
                const rowWins = rowModel === mu.modelA ? mu.winsA : mu.winsB;
                const colWins = rowModel === mu.modelA ? mu.winsB : mu.winsA;
                const label = rowWins > colWins ? `W ${rowWins}-${colWins}`
                    : rowWins < colWins ? `L ${rowWins}-${colWins}`
                    : `T ${rowWins}-${colWins}`;
                if (mu.ties > 0 && rowWins !== colWins) {
                    return pad(`${label} (${mu.ties}t)`, cellWidth);
                }
                return pad(label, cellWidth);
            });

            console.log(pad(rowModel, nameWidth) + cells.join("  "));
        }
    }

    console.log("");
}

/** Save ELO results to disk, merging with any existing results. */
export function saveEloResults(
    results: EloResults,
    outputPath: string,
): void {
    let existing: EloResults = { models: [], matchups: [] };
    if (existsSync(outputPath)) {
        try {
            existing = JSON.parse(readFileSync(outputPath, "utf-8"));
        } catch {
            console.warn(`  Warning: could not parse existing ${outputPath}, overwriting.`);
        }
    }

    // Merge models: new data wins on conflict
    const merged = new Map<string, EloModelStats>(
        (existing.models ?? []).map((m) => [m.model, m]),
    );
    for (const model of results.models) {
        merged.set(model.model, model);
    }

    const mergedModels = [...merged.values()].sort((a, b) => b.elo - a.elo);

    const output: EloResults = {
        models: mergedModels,
        matchups: results.matchups,
    };

    writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
    console.log(
        `ELO results saved to ${outputPath} (${mergedModels.length} models)`,
    );
}
