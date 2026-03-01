import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { Criterion, Evaluation, EvaluationFile, ModelResult, TaskInfo } from './types.js';
import { dirToId, formatTaskName, parseEvalFilename } from './utils.js';

// Navigate from dashboard/ up to repo root.
// Using process.cwd() instead of import.meta.url so that the path resolves
// correctly during both `vite dev` and the prerender step of `vite build`
// (where import.meta.url points into .svelte-kit/output/server/).
const REPO_ROOT = resolve(process.cwd(), '..');

// Read paths from benchmark.config.json so the dashboard stays in sync with
// any customised config rather than assuming default directory names.
interface BenchmarkConfig {
	tasksDir?: string;
	responsesDir?: string;
	evaluationsDir?: string;
}

function loadBenchmarkConfig(): BenchmarkConfig {
	const configPath = join(REPO_ROOT, 'benchmark.config.json');
	if (!existsSync(configPath)) return {};
	try {
		return JSON.parse(readFileSync(configPath, 'utf-8')) as BenchmarkConfig;
	} catch {
		return {};
	}
}

const _cfg = loadBenchmarkConfig();
const TASKS_DIR = resolve(REPO_ROOT, _cfg.tasksDir ?? './tasks');
const RESPONSES_DIR = resolve(REPO_ROOT, _cfg.responsesDir ?? './responses');
const EVALUATIONS_DIR = resolve(REPO_ROOT, _cfg.evaluationsDir ?? './evaluations');

// ── Directory helpers ────────────────────────────────────────────

function safeRead(path: string): string {
	if (!existsSync(path)) return '';
	return readFileSync(path, 'utf-8');
}

function safeDirs(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name);
}

function safeFiles(dir: string, ext = '.json'): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter((f) => f.endsWith(ext));
}

// ── Task data ────────────────────────────────────────────────────

export function getTaskNames(): string[] {
	return safeDirs(TASKS_DIR).sort();
}

export function getTaskInfo(task: string): TaskInfo {
	const taskDir = join(TASKS_DIR, task);
	const prompt = safeRead(join(taskDir, 'prompt.txt'));

	let criteria: Criterion[] = [];
	const criteriaPath = join(taskDir, 'criteria.json');
	if (existsSync(criteriaPath)) {
		try {
			const parsed = JSON.parse(readFileSync(criteriaPath, 'utf-8'));
			criteria = parsed.criteria ?? [];
		} catch {
			// ignore
		}
	}

	// Default criteria if none defined — kept in sync with src/schemas.ts DEFAULT_CRITERIA
	if (criteria.length === 0) {
		criteria = [
			{ name: 'completeness', description: 'Does the response fully address the task?' },
			{ name: 'richness', description: 'Does it explain reasoning, trade-offs, or how to use the result?' },
			{ name: 'organization', description: 'Is the output well-structured, clear, and easy to follow?' },
			{ name: 'best_practices', description: 'Does it follow modern conventions relevant to the domain?' }
		];
	}

	return {
		task,
		displayName: formatTaskName(task),
		prompt,
		criteria
	};
}

// ── Model data ───────────────────────────────────────────────────

export function getModelDirs(): string[] {
	return safeDirs(RESPONSES_DIR).sort();
}

export function getModelResponse(modelDir: string, task: string): string {
	return safeRead(join(RESPONSES_DIR, modelDir, `${task}.md`));
}

// ── Evaluation data ──────────────────────────────────────────────

export function getEvaluationsForTask(task: string): {
	modelDir: string;
	judgeDir: string;
	evaluation: Evaluation;
}[] {
	const taskDir = join(EVALUATIONS_DIR, task);
	const files = safeFiles(taskDir);
	const results: { modelDir: string; judgeDir: string; evaluation: Evaluation }[] = [];

	for (const file of files) {
		const parsed = parseEvalFilename(file);
		if (!parsed) continue;

		try {
			const raw: EvaluationFile = JSON.parse(readFileSync(join(taskDir, file), 'utf-8'));
			const criterionScores = Object.values(raw.scores);
			const avgScore =
				criterionScores.length > 0
					? criterionScores.reduce((a, b) => a + b, 0) / criterionScores.length
					: 0;

			results.push({
				modelDir: parsed.modelDir,
				judgeDir: parsed.judgeDir,
				evaluation: {
					judge: dirToId(parsed.judgeDir),
					judgeDir: parsed.judgeDir,
					reasoning: raw.reasoning,
					scores: raw.scores,
					avgScore
				}
			});
		} catch {
			// skip malformed
		}
	}

	return results;
}

export function getSingleEvaluation(
	task: string,
	modelDir: string,
	judgeDir: string
): Evaluation | null {
	const filePath = join(EVALUATIONS_DIR, task, `${modelDir}__${judgeDir}.json`);
	if (!existsSync(filePath)) return null;

	try {
		const raw: EvaluationFile = JSON.parse(readFileSync(filePath, 'utf-8'));
		const criterionScores = Object.values(raw.scores);
		const avgScore =
			criterionScores.length > 0
				? criterionScores.reduce((a, b) => a + b, 0) / criterionScores.length
				: 0;

		return {
			judge: dirToId(judgeDir),
			judgeDir,
			reasoning: raw.reasoning,
			scores: raw.scores,
			avgScore
		};
	} catch {
		return null;
	}
}

// ── Leaderboard ──────────────────────────────────────────────────

interface RawResult {
	model: string;
	avgScore: number;
	stdDev: number;
	bestTask: string;
	worstTask: string;
	taskScores: Record<string, number>;
}

export function getLeaderboard(): ModelResult[] {
	const resultsPath = join(EVALUATIONS_DIR, 'results.json');
	if (!existsSync(resultsPath)) return [];

	let raw: RawResult[] = [];
	try {
		raw = JSON.parse(readFileSync(resultsPath, 'utf-8'));
	} catch {
		return [];
	}

	const modelDirs = getModelDirs();

	return raw.map((r) => {
		// Map short provider key (e.g. "deepseek") to full dir (e.g. "deepseek__deepseek-v3.2")
		const modelDir = modelDirs.find((d) => d.split('__')[0] === r.model) ?? r.model;
		return {
			...r,
			modelDir,
			modelId: dirToId(modelDir)
		};
	});
}

// ── All judges ───────────────────────────────────────────────────

export function getJudgeDirs(): string[] {
	// safeDirs() already returns only directories, so results.json is never included.
	const tasks = safeDirs(EVALUATIONS_DIR);
	const judges = new Set<string>();
	for (const task of tasks) {
		const files = safeFiles(join(EVALUATIONS_DIR, task));
		for (const file of files) {
			const parsed = parseEvalFilename(file);
			if (parsed) judges.add(parsed.judgeDir);
		}
	}
	return Array.from(judges).sort();
}
