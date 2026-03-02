<script lang="ts">
	import Breadcrumb from '$lib/Breadcrumb.svelte';
	import { dirToId, fmt, formatCriterionName, formatTaskName, pct } from '$lib/utils.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	const hasElo = $derived(data.eloEntry != null);
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

	{#if hasElo && data.eloEntry}
		<div class="stat-row" style="margin-top: 0.75rem">
			<div class="stat">
				<span class="stat-val">{data.eloEntry.elo}</span>
				<span class="stat-label">ELO</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat">
				<span class="stat-val">#{data.eloRank}</span>
				<span class="stat-label">ELO Rank</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat">
				<span class="stat-val">{data.eloEntry.wins}W {data.eloEntry.losses}L</span>
				<span class="stat-label">Record</span>
			</div>
			<div class="stat-divider"></div>
			<div class="stat">
				<span class="stat-val">{fmt(data.eloEntry.scaled)}</span>
				<span class="stat-label">Score (0–100)</span>
			</div>
		</div>
	{/if}
</header>

<!-- ── Head-to-Head ───────────────────────────────────────────── -->
{#if hasElo && data.eloMatchups.length > 0}
	<section class="h2h-section">
		<h2 class="section-label">Head-to-Head</h2>
		<div class="h2h-list">
			{#each data.eloMatchups as mu}
				{@const isA = mu.modelA === data.modelDir}
				{@const opponent = isA ? mu.modelB : mu.modelA}
				{@const myWins = isA ? mu.winsA : mu.winsB}
				{@const oppWins = isA ? mu.winsB : mu.winsA}
				{@const result = myWins > oppWins ? 'win' : myWins < oppWins ? 'loss' : 'draw'}
				{@const total = myWins + oppWins + mu.ties}
				<a href="/model/{opponent}" class="h2h-row">
					<span class="h2h-opponent">{dirToId(opponent)}</span>
					<div class="h2h-bar-track">
						{#if total > 0}
							<div class="h2h-bar-win" style="width: {(myWins / total) * 100}%"></div>
							<div class="h2h-bar-tie" style="width: {(mu.ties / total) * 100}%"></div>
						{/if}
					</div>
					<span class="h2h-record {result}">{myWins}W-{oppWins}L{#if mu.ties > 0} {mu.ties}T{/if}</span>
				</a>
			{/each}
		</div>
	</section>
{/if}

<!-- ── Per-Task ELO ──────────────────────────────────────────────── -->
{#if hasElo && data.eloEntry && Object.keys(data.eloEntry.taskElos).length > 0}
	<section class="task-elo-section">
		<h2 class="section-label">Per-Task ELO</h2>
		<div class="task-elo-list">
			{#each Object.entries(data.eloEntry.taskElos).sort((a, b) => b[1] - a[1]) as [task, elo]}
				<a href="/task/{task}" class="task-elo-row">
					<span class="task-elo-name">{formatTaskName(task)}</span>
					<span class="task-elo-val">{elo}</span>
				</a>
			{/each}
		</div>
	</section>
{/if}

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

	// ── Head-to-Head ─────────────────────────────────────────────
	.h2h-section {
		margin-bottom: 2.5rem;
	}

	.h2h-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.h2h-row {
		display: grid;
		grid-template-columns: minmax(140px, 200px) 1fr auto;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border-light);
		border-radius: var(--radius);
		text-decoration: none;
		color: inherit;
		transition: border-color 0.12s;

		&:hover {
			border-color: var(--accent-light);
			text-decoration: none;
		}
	}

	.h2h-opponent {
		font-family: var(--font-mono);
		font-size: 0.82rem;
		font-weight: 500;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.h2h-bar-track {
		display: flex;
		height: 5px;
		background: #dc2626;
		border-radius: 3px;
		overflow: hidden;
		opacity: 0.7;
	}

	.h2h-bar-win {
		height: 100%;
		background: #16a34a;
	}

	.h2h-bar-tie {
		height: 100%;
		background: var(--border);
	}

	.h2h-record {
		font-size: 0.78rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		min-width: 5.5rem;
		text-align: right;

		&.win { color: #16a34a; }
		&.loss { color: #dc2626; }
		&.draw { color: var(--text-muted); }
	}

	// ── Per-Task ELO ─────────────────────────────────────────────
	.task-elo-section {
		margin-bottom: 2.5rem;
	}

	.task-elo-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.task-elo-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.65rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border-light);
		border-radius: var(--radius);
		text-decoration: none;
		color: inherit;
		transition: border-color 0.12s;

		&:hover {
			border-color: var(--accent-light);
			text-decoration: none;
		}
	}

	.task-elo-name {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text);
	}

	.task-elo-val {
		font-size: 0.875rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
</style>
