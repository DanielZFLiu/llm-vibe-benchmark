export interface ModelResult {
	model: string; // short provider key from results.json (e.g. "deepseek")
	modelDir: string; // filesystem dir (e.g. "deepseek__deepseek-v3.2")
	modelId: string; // full OpenRouter ID (e.g. "deepseek/deepseek-v3.2")
	avgScore: number;
	stdDev: number;
	bestTask: string;
	worstTask: string;
	taskScores: Record<string, number>;
}

export interface Criterion {
	name: string;
	description: string;
	rubric?: string;
}

export interface Evaluation {
	judge: string; // full judge ID
	judgeDir: string; // filesystem-safe judge dir
	reasoning: string;
	scores: Record<string, number>;
	avgScore: number;
}

export interface EvaluationFile {
	judge: string;
	reasoning: string;
	scores: Record<string, number>;
}

export interface TaskInfo {
	task: string;
	displayName: string;
	prompt: string;
	criteria: Criterion[];
}

export interface ModelTaskEval {
	task: string;
	displayName: string;
	evaluations: Evaluation[];
	avgScore: number;
}
