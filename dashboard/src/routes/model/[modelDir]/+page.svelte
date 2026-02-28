<script lang="ts">
	import Breadcrumb from '$lib/Breadcrumb.svelte';
	import { fmt, formatCriterionName, formatTaskName, pct } from '$lib/utils.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.modelId} — LLM Vibe Benchmark</title>
</svelte:head>

<Breadcrumb items={[{ label: 'Leaderboard', href: '/' }, { label: data.modelId }]} />

<!-- ── Header ────────────────────────────────────────────────── -->
<header class="page-header">
	<div class="header-rank">
		{#if data.rank > 0}
			<span class="rank-badge">#{data.rank}</span>
		{/if}
	</div>
	<h1 class="page-title">{data.modelId}</h1>

	{#if data.leaderboardEntry}
		<div class="stat-row">
			<div class="stat">
				<span class="stat-val">{fmt(data.leaderboardEntry.avgScore)}</span>
				<span class="stat-label">Avg Score</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat">
				<span class="stat-val">±{fmt(data.leaderboardEntry.stdDev)}</span>
				<span class="stat-label">Std Dev</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat">
				<span class="stat-val">{formatTaskName(data.leaderboardEntry.bestTask)}</span>
				<span class="stat-label">Best Task</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat">
				<span class="stat-val">{data.taskEvals.length}</span>
				<span class="stat-label">Tasks</span>
			</div>
		</div>
	{/if}
</header>

<!-- ── Task Evaluations ────────────────────────────────────────── -->
<section class="tasks-section">
	<h2 class="section-label">Evaluations by Task</h2>

	{#each data.taskEvals as taskEval (taskEval.task)}
		<div class="task-block">
			<div class="task-block-header">
				<div class="task-block-left">
					<a href="/task/{taskEval.task}" class="task-link">{formatTaskName(taskEval.task)}</a>
				</div>
				<div class="task-block-right">
					<span class="task-avg-score">{fmt(taskEval.avgScore)}</span>
					<a
						href="/model/{data.modelDir}/response/{taskEval.task}"
						class="view-response-btn"
					>View Response →</a>
				</div>
			</div>

			<!-- Per-judge evaluations -->
			<div class="judge-evals">
				{#each taskEval.judgeEvals as je (je.judgeDir)}
					<a href="/eval/{taskEval.task}/{data.modelDir}/{je.judgeDir}" class="judge-eval-card">
						<div class="jec-header">
							<span class="jec-judge">{je.judgeId}</span>
							<span class="jec-score">{fmt(je.avgScore)}</span>
						</div>
						<!-- Per-criterion mini scores -->
						<div class="jec-criteria">
							{#each Object.entries(je.scores) as [criterion, score]}
								<div class="jec-crit-row">
									<span class="jec-crit-name">{formatCriterionName(criterion)}</span>
									<div class="jec-bar-track">
										<div class="jec-bar-fill" style="width: {pct(score)}%"></div>
									</div>
									<span class="jec-crit-score">{score}</span>
								</div>
							{/each}
						</div>
						<span class="jec-view-hint">See reasoning →</span>
					</a>
				{/each}
			</div>
		</div>
	{/each}
</section>

<style lang="scss">
	// ── Header ───────────────────────────────────────────────────
	.page-header {
		margin-bottom: 2.5rem;
	}

	.header-rank {
		margin-bottom: 0.5rem;
	}

	.rank-badge {
		display: inline-block;
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--accent);
		background: var(--accent-faint);
		border: 1px solid var(--accent-light);
		padding: 0.2rem 0.6rem;
		border-radius: 20px;
		letter-spacing: 0.03em;
	}

	.page-title {
		font-size: 1.8rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		font-family: var(--font-mono);
		margin-bottom: 1.25rem;
		word-break: break-all;
	}

	.stat-row {
		display: flex;
		align-items: center;
		gap: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		width: fit-content;
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0.75rem 1.5rem;
		gap: 0.15rem;
	}

	.stat-val {
		font-size: 1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.stat-label {
		font-size: 0.68rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-faint);
	}

	.stat-divider {
		width: 1px;
		height: 2.5rem;
		background: var(--border);
	}

	// ── Section label ─────────────────────────────────────────────
	.section-label {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-faint);
		margin-bottom: 1rem;
	}

	// ── Task blocks ───────────────────────────────────────────────
	.tasks-section {
		margin-bottom: 2rem;
	}

	.task-block {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 1rem;
		overflow: hidden;
	}

	.task-block-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--border-light);
		gap: 1rem;
	}

	.task-block-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.task-link {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
		text-decoration: none;

		&:hover { color: var(--accent); text-decoration: none; }
	}

	.task-block-right {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}

	.task-avg-score {
		font-size: 1.2rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.view-response-btn {
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--accent);
		text-decoration: none;
		white-space: nowrap;

		&:hover { text-decoration: underline; }
	}

	// ── Judge eval cards ──────────────────────────────────────────
	.judge-evals {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0;
	}

	.judge-eval-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.125rem 1.5rem;
		border-right: 1px solid var(--border-light);
		border-bottom: 1px solid var(--border-light);
		text-decoration: none;
		color: inherit;
		transition: background 0.12s;

		&:last-child { border-right: none; }
		&:hover { background: var(--surface-hover); text-decoration: none; }
	}

	.jec-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.jec-judge {
		font-size: 0.78rem;
		font-family: var(--font-mono);
		color: var(--text-muted);
		font-weight: 500;
	}

	.jec-score {
		font-size: 1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.jec-criteria {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.jec-crit-row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		gap: 0.5rem;
	}

	.jec-crit-name {
		font-size: 0.72rem;
		color: var(--text-faint);
		text-transform: capitalize;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.jec-bar-track {
		width: 60px;
		height: 4px;
		background: var(--border);
		border-radius: 2px;
		overflow: hidden;
	}

	.jec-bar-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 2px;
		opacity: 0.8;
	}

	.jec-crit-score {
		font-size: 0.72rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		min-width: 2rem;
		text-align: right;
	}

	.jec-view-hint {
		font-size: 0.72rem;
		color: var(--accent);
		opacity: 0;
		transition: opacity 0.12s;
	}

	.judge-eval-card:hover .jec-view-hint {
		opacity: 1;
	}
</style>
