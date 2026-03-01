<script lang="ts">
	import { formatTaskName, fmt, pct } from '$lib/utils.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	const topScore = $derived(data.leaderboard[0]?.avgScore ?? 100);
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
		Models ranked by average score across all tasks and judges.
		Click any model to explore its responses and per-judge evaluations.
	</p>
</section>

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
		margin-bottom: 3rem;
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
