<script lang="ts">
	import { formatTaskName, fmt, pct } from '$lib/utils.js';
	import type { PageData } from './$types.js';
	import type { EloMatchup } from '$lib/types.js';

	let { data }: { data: PageData } = $props();

	const topScore = $derived(data.leaderboard[0]?.avgScore ?? 100);
	const hasElo = $derived(data.eloResults != null && data.eloResults.models.length > 0);

	let mode: 'score' | 'elo' = $state('score');

	// Per-task ELO range for scaling mini-bars
	function taskEloPct(task: string, elo: number): number {
		if (!data.eloResults) return 0;
		const elos = data.eloResults.models
			.map((m) => m.taskElos[task])
			.filter((e): e is number => e != null);
		if (elos.length === 0) return 0;
		const min = Math.min(...elos);
		const max = Math.max(...elos);
		return max > min ? ((elo - min) / (max - min)) * 100 : 50;
	}

	// Head-to-head lookup helper
	function getMatchup(modelA: string, modelB: string): EloMatchup | null {
		if (!data.eloResults) return null;
		return data.eloResults.matchups.find(
			(m) =>
				(m.modelA === modelA && m.modelB === modelB) ||
				(m.modelA === modelB && m.modelB === modelA)
		) ?? null;
	}

	function matchupLabel(rowModel: string, colModel: string): { text: string; cls: string } {
		const mu = getMatchup(rowModel, colModel);
		if (!mu) return { text: '--', cls: '' };

		const rowWins = rowModel === mu.modelA ? mu.winsA : mu.winsB;
		const colWins = rowModel === mu.modelA ? mu.winsB : mu.winsA;
		const total = rowWins + colWins + mu.ties;

		if (rowWins > colWins) return { text: `${rowWins}W-${colWins}L`, cls: 'win' };
		if (rowWins < colWins) return { text: `${rowWins}W-${colWins}L`, cls: 'loss' };
		return { text: `${rowWins}-${colWins}`, cls: 'draw' };
	}
</script>

<svelte:head>
	<title>LLM Vibe Benchmark — Leaderboard</title>
</svelte:head>

<section class="hero">
	<div class="hero-meta">
		<span>{data.leaderboard.length} models</span>
		<span class="dot">·</span>
		<span>{data.tasks.length} tasks</span>
		<span class="dot">·</span>
		<span>{data.judgeCount} judges</span>
	</div>
	<h1 class="hero-title">Leaderboard</h1>
	<p class="hero-sub">
		{#if mode === 'elo'}
			Models ranked by pairwise ELO ratings across all tasks and judges.
		{:else}
			Models ranked by average score across all tasks and judges.
		{/if}
		Click any model to explore its evaluations.
	</p>
</section>

<!-- ── Mode Toggle ───────────────────────────────────────────── -->
{#if hasElo}
	<div class="mode-toggle-wrap">
		<div class="mode-toggle">
			<button
				class="mode-btn"
				class:active={mode === 'score'}
				onclick={() => (mode = 'score')}
			>
				Score
			</button>
			<button
				class="mode-btn"
				class:active={mode === 'elo'}
				onclick={() => (mode = 'elo')}
			>
				ELO
			</button>
		</div>
		<span class="mode-hint">
			{mode === 'score' ? 'Absolute scores (0-100) averaged across judges' : 'Pairwise comparison ELO ratings'}
		</span>
	</div>
{/if}

{#if mode === 'score'}
	<!-- ── Main Rankings ─────────────────────────────────────────── -->
	<section class="rankings">
		{#each data.leaderboard as entry, i (entry.modelDir)}
			<a href="/model/{entry.modelDir}" class="rank-row">
				<span class="rank-num" class:gold={i === 0} class:silver={i === 1} class:bronze={i === 2}>
					#{i + 1}
				</span>

				<div class="rank-info">
					<span class="rank-model">{entry.modelId}</span>
					<div class="rank-bar-wrap">
						<div class="rank-bar">
							<div class="rank-bar-fill" style="width: {pct((entry.avgScore / topScore) * 100)}%"></div>
						</div>
					</div>
				</div>

				<div class="rank-stats">
					<span class="rank-score">{fmt(entry.avgScore)}</span>
					<span class="rank-stddev">±{fmt(entry.stdDev)}</span>
				</div>
			</a>
		{/each}
	</section>

	<!-- ── Task Comparison Matrix ────────────────────────────────── -->
	<section class="matrix-section">
		<h2 class="section-label">Per-Task Scores</h2>
		<div class="matrix-wrap">
			<table class="matrix">
				<thead>
					<tr>
						<th class="th-model">Model</th>
						{#each data.tasks as task}
							<th>
								<a href="/task/{task}">{formatTaskName(task)}</a>
							</th>
						{/each}
						<th class="th-avg">Avg</th>
					</tr>
				</thead>
				<tbody>
					{#each data.leaderboard as entry, i}
						<tr>
							<td class="td-model">
								<a href="/model/{entry.modelDir}" class="model-link">
									<span class="model-rank">#{i + 1}</span>
									{entry.modelId}
								</a>
							</td>
							{#each data.tasks as task}
								<td class="td-score">
									{#if entry.taskScores[task] != null}
										<a href="/task/{task}" class="score-cell">
											<span class="score-val">{fmt(entry.taskScores[task])}</span>
											<div class="mini-bar">
												<div
													class="mini-bar-fill"
													style="width: {pct(entry.taskScores[task])}%"
												></div>
											</div>
										</a>
									{:else}
										<span class="score-na">—</span>
									{/if}
								</td>
							{/each}
							<td class="td-avg">
								<strong>{fmt(entry.avgScore)}</strong>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{:else if data.eloResults}
	<!-- ── ELO Rankings ──────────────────────────────────────────── -->
	<section class="rankings">
		{#each data.eloResults.models as entry, i (entry.model)}
			{@const topElo = data.eloResults.models[0]?.elo ?? 1500}
			<a href="/model/{entry.model}" class="rank-row">
				<span class="rank-num" class:gold={i === 0} class:silver={i === 1} class:bronze={i === 2}>
					#{i + 1}
				</span>

				<div class="rank-info">
					<span class="rank-model">{entry.modelId}</span>
					<div class="rank-bar-wrap">
						<div class="rank-bar">
							<div class="rank-bar-fill" style="width: {pct(entry.scaled)}%"></div>
						</div>
					</div>
				</div>

				<div class="rank-stats">
					<span class="rank-score">{entry.elo}</span>
					<span class="rank-stddev elo-record">{entry.wins}W {entry.losses}L {entry.ties}T</span>
				</div>
			</a>
		{/each}
	</section>

	<!-- ── Per-Task ELO Matrix ───────────────────────────────────── -->
	<section class="matrix-section">
		<h2 class="section-label">Per-Task ELO</h2>
		<div class="matrix-wrap">
			<table class="matrix">
				<thead>
					<tr>
						<th class="th-model">Model</th>
						{#each data.tasks as task}
							<th>
								<a href="/task/{task}">{formatTaskName(task)}</a>
							</th>
						{/each}
						<th class="th-avg">Global</th>
					</tr>
				</thead>
				<tbody>
					{#each data.eloResults.models as entry, i}
						<tr>
							<td class="td-model">
								<a href="/model/{entry.model}" class="model-link">
									<span class="model-rank">#{i + 1}</span>
									{entry.modelId}
								</a>
							</td>
							{#each data.tasks as task}
								<td class="td-score">
									{#if entry.taskElos[task] != null}
										<a href="/task/{task}" class="score-cell">
											<span class="score-val">{entry.taskElos[task]}</span>
											<div class="mini-bar">
												<div
													class="mini-bar-fill"
													style="width: {pct(taskEloPct(task, entry.taskElos[task]))}%"
												></div>
											</div>
										</a>
									{:else}
										<span class="score-na">—</span>
									{/if}
								</td>
							{/each}
							<td class="td-avg">
								<strong>{entry.elo}</strong>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- ── Head-to-Head Matrix ───────────────────────────────────── -->
	{#if data.eloResults.matchups.length > 0}
		<section class="matrix-section">
			<h2 class="section-label">Head-to-Head</h2>
			<div class="matrix-wrap">
				<table class="matrix h2h-matrix">
					<thead>
						<tr>
							<th class="th-model">Model</th>
							{#each data.eloResults.models as col}
								<th class="h2h-col-header">{col.modelId.split('/')[1] ?? col.modelId}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each data.eloResults.models as row, ri}
							<tr>
								<td class="td-model">
									<a href="/model/{row.model}" class="model-link">
										<span class="model-rank">#{ri + 1}</span>
										{row.modelId}
									</a>
								</td>
								{#each data.eloResults.models as col}
									<td class="td-h2h">
										{#if row.model === col.model}
											<span class="h2h-self">--</span>
										{:else}
											{@const result = matchupLabel(row.model, col.model)}
											<span class="h2h-cell {result.cls}">{result.text}</span>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
{/if}

<!-- ── Tasks Quick Access ────────────────────────────────────── -->
<section class="tasks-section">
	<h2 class="section-label">Tasks</h2>
	<div class="task-cards">
		{#each data.tasks as task}
			<a href="/task/{task}" class="task-card">
				<span class="task-card-name">{formatTaskName(task)}</span>
				<span class="task-card-arrow">→</span>
			</a>
		{/each}
	</div>
</section>

<style lang="scss">
	// ── Hero ───────────────────────────────────────────────────────
	.hero {
		margin-bottom: 2rem;
	}

	.hero-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: var(--text-faint);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 500;
		margin-bottom: 0.75rem;
	}

	.dot { opacity: 0.4; }

	.hero-title {
		font-size: 2.25rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		margin-bottom: 0.6rem;
		color: var(--text);
	}

	.hero-sub {
		font-size: 0.925rem;
		color: var(--text-muted);
		max-width: 540px;
		line-height: 1.6;
	}

	// ── Mode Toggle ──────────────────────────────────────────────
	.mode-toggle-wrap {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.mode-toggle {
		display: flex;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.mode-btn {
		padding: 0.45rem 1.1rem;
		border: none;
		background: transparent;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
		font-family: var(--font);

		&:not(:last-child) {
			border-right: 1px solid var(--border);
		}

		&:hover {
			background: var(--surface-hover);
			color: var(--text);
		}

		&.active {
			background: var(--accent-faint);
			color: var(--accent);
		}
	}

	.mode-hint {
		font-size: 0.78rem;
		color: var(--text-faint);
	}

	// ── Rankings ──────────────────────────────────────────────────
	.rankings {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 3.5rem;
	}

	.rank-row {
		display: grid;
		grid-template-columns: 2.5rem 1fr auto;
		align-items: center;
		gap: 1.25rem;
		padding: 1rem 1.25rem;
		border-radius: var(--radius);
		border: 1px solid transparent;
		text-decoration: none;
		color: inherit;
		transition: background 0.12s, border-color 0.12s;
		background: var(--surface);
		border-color: var(--border-light);

		&:hover {
			background: var(--surface);
			border-color: var(--accent-light);

			.rank-model {
				color: var(--accent);
			}
		}

		&:first-child {
			border-color: var(--accent-light);
		}
	}

	.rank-num {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--text-faint);
		text-align: center;
		font-variant-numeric: tabular-nums;

		&.gold   { color: #B8860B; }
		&.silver { color: #707070; }
		&.bronze { color: #8B5A2B; }
	}

	.rank-info {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	.rank-model {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--text);
		font-family: var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.12s;
	}

	.rank-bar-wrap {
		display: flex;
		align-items: center;
	}

	.rank-bar {
		height: 5px;
		background: var(--border);
		border-radius: 3px;
		width: 100%;
		overflow: hidden;
	}

	.rank-bar-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 3px;
		transition: width 0.4s ease;
	}

	.rank-stats {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1rem;
	}

	.rank-score {
		font-size: 1.05rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	.rank-stddev {
		font-size: 0.72rem;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.elo-record {
		font-size: 0.72rem;
		color: var(--text-faint);
		letter-spacing: 0.02em;
	}

	// ── Section label ────────────────────────────────────────────
	.section-label {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-faint);
		margin-bottom: 1rem;
	}

	// ── Matrix ────────────────────────────────────────────────────
	.matrix-section {
		margin-bottom: 3rem;
	}

	.matrix-wrap {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.matrix {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.855rem;
		background: var(--surface);

		th, td {
			padding: 0.7rem 1rem;
			border-bottom: 1px solid var(--border-light);
			text-align: left;
		}

		thead th {
			font-size: 0.75rem;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--text-muted);
			background: var(--bg);
			white-space: nowrap;

			a {
				color: var(--text-muted);
				text-decoration: none;
				&:hover { color: var(--accent); }
			}
		}

		tbody tr {
			&:last-child td { border-bottom: none; }
			&:hover td { background: var(--surface-hover); }
		}
	}

	.th-model {
		min-width: 200px;
		position: sticky;
		left: 0;
		z-index: 2;
		background: var(--bg);
	}
	.th-avg { text-align: right; }

	.td-model {
		white-space: nowrap;
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--surface);
	}

	.matrix tbody tr:hover .td-model {
		background: var(--surface-hover);
	}
	.td-avg {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.model-link {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text);
		text-decoration: none;
		font-family: var(--font-mono);
		font-size: 0.84rem;

		&:hover {
			color: var(--accent);
			text-decoration: none;
		}
	}

	.model-rank {
		font-size: 0.68rem;
		color: var(--text-faint);
		font-family: var(--font);
		font-weight: 600;
		min-width: 1.75rem;
	}

	.td-score { min-width: 120px; }

	.score-cell {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		text-decoration: none;
		color: inherit;
	}

	.score-val {
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}

	.mini-bar {
		height: 3px;
		background: var(--border);
		border-radius: 2px;
		overflow: hidden;
	}

	.mini-bar-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 2px;
		opacity: 0.7;
	}

	.score-na {
		color: var(--text-faint);
	}

	// ── Head-to-Head Matrix ──────────────────────────────────────
	.h2h-matrix {
		th, td {
			text-align: center;
			padding: 0.55rem 0.6rem;
		}
	}

	.h2h-col-header {
		max-width: 100px;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.7rem !important;
	}

	.td-h2h {
		min-width: 80px;
	}

	.h2h-self {
		color: var(--border);
		font-size: 0.8rem;
	}

	.h2h-cell {
		font-size: 0.78rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;

		&.win {
			color: #16a34a;
		}

		&.loss {
			color: #dc2626;
		}

		&.draw {
			color: var(--text-muted);
		}
	}

	// ── Tasks section ─────────────────────────────────────────────
	.tasks-section {
		margin-bottom: 2rem;
	}

	.task-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 0.75rem;
	}

	.task-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
		font-weight: 500;
		font-size: 0.9rem;
		transition: border-color 0.12s, background 0.12s;

		&:hover {
			border-color: var(--accent-light);
			background: var(--accent-faint);
			text-decoration: none;
			color: var(--accent);
		}
	}

	.task-card-arrow {
		color: var(--text-faint);
		font-size: 1rem;
		transition: transform 0.12s, color 0.12s;
	}

	.task-card:hover .task-card-arrow {
		transform: translateX(3px);
		color: var(--accent);
	}
</style>
