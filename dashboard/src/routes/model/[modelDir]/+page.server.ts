import { getEvaluationsForTask, getLeaderboard, getModelDirs, getTaskNames } from '$lib/data.server.js';
import { dirToId } from '$lib/utils.js';
import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageServerLoad } from './$types.js';

export const entries: EntryGenerator = () => {
	return getModelDirs().map((modelDir) => ({ modelDir }));
};

export const load: PageServerLoad = async ({ params }) => {
	const { modelDir } = params;

	const allModelDirs = getModelDirs();
	if (!allModelDirs.includes(modelDir)) {
		error(404, `Model "${modelDir}" not found`);
	}

	const modelId = dirToId(modelDir);
	const tasks = getTaskNames();
	const leaderboard = getLeaderboard();
	const rank = leaderboard.findIndex((m) => m.modelDir === modelDir) + 1;
	const leaderboardEntry = leaderboard.find((m) => m.modelDir === modelDir);

	// Gather per-task evaluations
	const taskEvals: {
		task: string;
		avgScore: number;
		judgeEvals: {
			judgeDir: string;
			judgeId: string;
			avgScore: number;
			scores: Record<string, number>;
		}[];
	}[] = [];

	for (const task of tasks) {
		const rawEvals = getEvaluationsForTask(task);
		const modelEvals = rawEvals.filter((e) => e.modelDir === modelDir);

		if (modelEvals.length === 0) continue;

		const judgeEvals = modelEvals.map(({ judgeDir, evaluation }) => ({
			judgeDir,
			judgeId: dirToId(judgeDir),
			avgScore: evaluation.avgScore,
			scores: evaluation.scores
		}));

		const avgScore =
			judgeEvals.reduce((a, e) => a + e.avgScore, 0) / judgeEvals.length;

		taskEvals.push({ task, avgScore, judgeEvals });
	}

	// Sort by task avg score descending
	taskEvals.sort((a, b) => b.avgScore - a.avgScore);

	return {
		modelDir,
		modelId,
		rank,
		leaderboardEntry: leaderboardEntry ?? null,
		taskEvals
	};
};
