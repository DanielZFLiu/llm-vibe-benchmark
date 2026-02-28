/**
 * Convert a filesystem-safe dir name (double-underscore) to a display model ID (slash).
 * Only replaces the first __ to reconstruct "provider/model".
 */
export function dirToId(dir: string): string {
	const idx = dir.indexOf('__');
	if (idx === -1) return dir;
	return dir.substring(0, idx) + '/' + dir.substring(idx + 2);
}

/**
 * Convert a snake_case task name to a human-readable display name.
 */
export function formatTaskName(task: string): string {
	return task
		.split('_')
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

/**
 * Round a number to 1 decimal place for display.
 */
export function fmt(n: number): string {
	return n.toFixed(1);
}

/**
 * Clamp a value between 0 and 100 for percentage widths.
 */
export function pct(score: number): number {
	return Math.min(100, Math.max(0, score));
}

/**
 * Convert a snake_case criterion name to a human-readable label.
 */
export function formatCriterionName(name: string): string {
	return name.replace(/_/g, ' ');
}

/**
 * Parse an evaluation filename into { modelDir, judgeDir }.
 * Format: {provider}__{model}__{judgeprovider}__{judgemodel}.json
 */
export function parseEvalFilename(filename: string): { modelDir: string; judgeDir: string } | null {
	const base = filename.replace(/\.json$/, '');
	const parts = base.split('__');
	if (parts.length < 4) return null;
	const modelDir = parts[0] + '__' + parts[1];
	const judgeDir = parts[2] + '__' + parts[3];
	return { modelDir, judgeDir };
}
