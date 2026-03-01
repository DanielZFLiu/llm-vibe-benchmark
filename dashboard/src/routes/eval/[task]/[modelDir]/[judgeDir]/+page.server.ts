import {
	getEvaluationsForTask,
	getModelResponse,
	getSingleEvaluation,
	getTaskInfo,
	getTaskNames
} from '$lib/data.server.js';
import { dirToId } from '$lib/utils.js';
import { error } from '@sveltejs/kit';
import { marked } from 'marked';
import type { EntryGenerator, PageServerLoad } from './$types.js';

export const entries: EntryGenerator = () => {
	const tasks = getTaskNames();
	const result: { task: string; modelDir: string; judgeDir: string }[] = [];
	for (const task of tasks) {
		for (const { modelDir, judgeDir } of getEvaluationsForTask(task)) {
			result.push({ task, modelDir, judgeDir });
		}
	}
	return result;
};

export const load: PageServerLoad = async ({ params }) => {
	const { task, modelDir, judgeDir } = params;

	const evaluation = getSingleEvaluation(task, modelDir, judgeDir);
	if (!evaluation) {
		error(404, `Evaluation not found for ${modelDir} judged by ${judgeDir} on ${task}`);
	}

	const taskInfo = getTaskInfo(task);
	const rawResponse = getModelResponse(modelDir, task);

	const [reasoningHtml, responseHtml] = await Promise.all([
		marked(evaluation.reasoning, { async: true }),
		rawResponse ? marked(rawResponse, { async: true }) : Promise.resolve('')
	]);

	return {
		task,
		displayName: taskInfo.displayName,
		taskInfo,
		modelDir,
		modelId: dirToId(modelDir),
		judgeDir,
		judgeId: dirToId(judgeDir),
		evaluation,
		reasoningHtml,
		responseHtml
	};
};
