import { getJudgeDirs, getLeaderboard, getTaskNames } from '$lib/data.server.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
	const leaderboard = getLeaderboard();
	const tasks = getTaskNames();
	const judgeDirs = getJudgeDirs();

	return {
		leaderboard,
		tasks,
		judgeCount: judgeDirs.length
	};
};
