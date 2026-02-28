import { getModelResponse, getTaskInfo } from '$lib/data.server.js';
import { dirToId } from '$lib/utils.js';
import { error } from '@sveltejs/kit';
import { marked } from 'marked';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params }) => {
	const { modelDir, task } = params;

	const rawResponse = getModelResponse(modelDir, task);
	if (!rawResponse) {
		error(404, `Response not found for ${modelDir} / ${task}`);
	}

	const taskInfo = getTaskInfo(task);
	const responseHtml = await marked(rawResponse, { async: true });

	return {
		modelDir,
		modelId: dirToId(modelDir),
		task,
		displayName: taskInfo.displayName,
		responseHtml
	};
};
