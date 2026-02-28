import {
	getEvaluationsForTask,
	getLeaderboard,
	getTaskInfo
} from '$lib/data.server.js';
import { dirToId, formatTaskName } from '$lib/utils.js';
import { error } from '@sveltejs/kit';
import { marked } from 'marked';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params }) => {
	const { task } = params;

	const taskInfo = getTaskInfo(task);
	if (!taskInfo.prompt && taskInfo.criteria.length === 0) {
		error(404, `Task "${task}" not found`);
	}

	const rawEvals = getEvaluationsForTask(task);
	const leaderboard = getLeaderboard();

	// Group evaluations by model, then by criterion aggregate
	const modelMap: Record<
		string,
		{
			modelDir: string;
			modelId: string;
			avgScore: number;
			judgeEvals: {
				judgeDir: string;
				judgeId: string;
				avgScore: number;
				scores: Record<string, number>;
			}[];
		}
	> = {};

	for (const { modelDir, judgeDir, evaluation } of rawEvals) {
		if (!modelMap[modelDir]) {
			modelMap[modelDir] = {
				modelDir,
				modelId: dirToId(modelDir),
				avgScore: 0,
				judgeEvals: []
			};
		}
		modelMap[modelDir].judgeEvals.push({
			judgeDir,
			judgeId: dirToId(judgeDir),
			avgScore: evaluation.avgScore,
			scores: evaluation.scores
		});
	}

	// Compute per-model average across all judges
	for (const entry of Object.values(modelMap)) {
		const sum = entry.judgeEvals.reduce((a, e) => a + e.avgScore, 0);
		entry.avgScore = entry.judgeEvals.length > 0 ? sum / entry.judgeEvals.length : 0;
	}

	// Sort models by avg score descending
	const models = Object.values(modelMap).sort((a, b) => b.avgScore - a.avgScore);

	// Get overall ranks from leaderboard
	const ranks: Record<string, number> = {};
	leaderboard.forEach((m, i) => {
		ranks[m.modelDir] = i + 1;
	});

	const promptHtml = taskInfo.prompt ? await marked(taskInfo.prompt, { async: true }) : '';

	return {
		task,
		displayName: formatTaskName(task),
		taskInfo,
		promptHtml,
		models,
		ranks
	};
};
