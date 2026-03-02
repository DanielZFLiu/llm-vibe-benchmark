<script lang="ts">
	import Breadcrumb from '$lib/Breadcrumb.svelte';
	import { fmt, formatCriterionName, pct } from '$lib/utils.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	const hasElo = $derived(data.eloRankings && data.eloRankings.length > 0);
	let mode: 'score' | 'elo' = $state('score');
</script>

<svelte:head>
	<title>{data.displayName} — LLM Vibe Benchmark</title>
</svelte:head>

<Breadcrumb items={[{ label: 'Leaderboard', href: '/' }, { label: data.displayName }]} />

<!-- ── Header ────────────────────────────────────────────────── -->
<header class="page-header">
	<h1 class="page-title">{data.displayName}</h1>
	<p class="page-sub">{data.models.length} models evaluated · {data.taskInfo.criteria.length} criteria</p>
</header>

<!-- ── Task Prompt ────────────────────────────────────────────── -->
{#if data.promptHtml}
	<section class="prompt-section">
		<h2 class="section-label">Task Prompt</h2>
		<div class="prompt-box">
			<div class="prose prompt-content">{@html data.promptHtml}</div>
		</div>
	</section>
{/if}

<!-- ── Criteria ───────────────────────────────────────────────── -->
<section class="criteria-section">
	<h2 class="section-label">Evaluation Criteria</h2>
	<div class="criteria-grid">
		{#each data.taskInfo.criteria as criterion}
			<div class="criterion-card">
				<div class="criterion-name">{formatCriterionName(criterion.name)}</div>
				<p class="criterion-desc">{criterion.description}</p>
			</div>
		{/each}
	</div>
</section>

<!-- ── Mode Toggle ────────────────────────────────────────────── -->
{#if hasElo}
	<div class="mode-toggle-wrap">
		<div class="mode-toggle">
			<button class="mode-btn" class:active={mode === 'score'} onclick={() => (mode = 'score')}>Score</button>
			<button class="mode-btn" class:active={mode === 'elo'} onclick={() => (mode = 'elo')}>ELO</button>
		</div>
	</div>
{/if}

<!-- ── Model Rankings for this Task ──────────────────────────── -->
{#if mode === 'score'}
	<section class="models-section">
		<h2 class="section-label">Model Rankings</h2>
		<div class="model-list">
			{#each data.models as model, i (model.modelDir)}
				<div class="model-block">
					<div class="model-block-header">
						<div class="model-block-left">
							<span class="task-rank">#{i + 1}</span>
							<a href="/model/{model.modelDir}" class="model-name">{model.modelId}</a>
							{#if data.ranks[model.modelDir]}
								<span class="overall-rank" title="Overall rank">#{data.ranks[model.modelDir]} overall</span>
							{/if}
						</div>
						<span class="model-avg">{fmt(model.avgScore)}</span>
					</div>

					<!-- Per-criterion bars averaged across judges -->
					{#if data.taskInfo.criteria.length > 0}
						<div class="criteria-bars">
							{#each data.taskInfo.criteria as criterion}
								{@const scores = model.judgeEvals.map((e) => e.scores[criterion.name] ?? 0).filter((s) => s > 0)}
								{@const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null}
								<div class="cbar-row">
									<span class="cbar-name">{formatCriterionName(criterion.name)}</span>
									<div class="cbar-track">
										<div class="cbar-fill" style="width: {avg != null ? pct(avg) : 0}%"></div>
									</div>
									<span class="cbar-val">{avg != null ? fmt(avg) : '—'}</span>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Per-judge scores -->
					<div class="judge-row">
						{#each model.judgeEvals as je}
							<a href="/eval/{data.task}/{model.modelDir}/{je.judgeDir}" class="judge-chip">
								<span class="judge-chip-name">{je.judgeId}</span>
								<span class="judge-chip-score">{fmt(je.avgScore)}</span>
							</a>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</section>
{:else if data.eloRankings}
	<section class="models-section">
		<h2 class="section-label">ELO Rankings</h2>
		<div class="model-list">
			{#each data.eloRankings as entry, i (entry.model)}
				<div class="model-block">
					<div class="model-block-header">
						<div class="model-block-left">
							<span class="task-rank">#{i + 1}</span>
							<a href="/model/{entry.model}" class="model-name">{entry.modelId}</a>
						</div>
						<div class="elo-stats">
							<span class="model-avg">{entry.elo}</span>
							<span class="elo-record">{entry.wins}W {entry.losses}L {entry.ties}T</span>
						</div>
					</div>

					<div class="elo-bar-wrap">
						<div class="cbar-track">
							<div class="cbar-fill" style="width: {pct(entry.scaled)}%"></div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</section>
{/if}

<style lang="scss">
	// ── Header ───────────────────────────────────────────────────
	.page-header {
		margin-bottom: 2.5rem;
	}

	.page-title {
		font-size: 1.9rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		margin-bottom: 0.4rem;
	}

	.page-sub {
		font-size: 0.875rem;
		color: var(--text-muted);
	}

	// ── Section label ─────────────────────────────────────────────
	.section-label {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-faint);
		margin-bottom: 0.9rem;
	}

	// ── Prompt ───────────────────────────────────────────────────
	.prompt-section {
		margin-bottom: 2.5rem;
	}

	.prompt-box {
		background: var(--surface);
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius);
		padding: 1.25rem 1.5rem;
	}

	// ── Criteria ─────────────────────────────────────────────────
	.criteria-section {
		margin-bottom: 2.5rem;
	}

	.criteria-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 0.75rem;
	}

	.criterion-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.125rem;
	}

	.criterion-name {
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--accent);
		margin-bottom: 0.4rem;
		text-transform: capitalize;
	}

	.criterion-desc {
		font-size: 0.825rem;
		color: var(--text-muted);
		line-height: 1.55;
	}

	// ── Models section ────────────────────────────────────────────
	.models-section {
		margin-bottom: 2rem;
	}

	.model-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.model-block {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem 1.5rem;
		transition: border-color 0.12s;

		&:hover {
			border-color: var(--accent-light);
		}
	}

	.model-block-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.model-block-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.task-rank {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--text-faint);
		min-width: 1.75rem;
	}

	.model-name {
		font-family: var(--font-mono);
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text);
		text-decoration: none;

		&:hover {
			color: var(--accent);
			text-decoration: none;
		}
	}

	.overall-rank {
		font-size: 0.72rem;
		color: var(--text-faint);
		background: var(--surface-hover);
		padding: 0.15rem 0.5rem;
		border-radius: 3px;
		border: 1px solid var(--border);
	}

	.model-avg {
		font-size: 1.15rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}

	// ── Criterion bars ────────────────────────────────────────────
	.criteria-bars {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.cbar-row {
		display: grid;
		grid-template-columns: minmax(80px, 160px) 1fr 3rem;
		align-items: center;
		gap: 0.75rem;
	}

	.cbar-name {
		font-size: 0.78rem;
		color: var(--text-muted);
		text-align: right;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-transform: capitalize;
	}

	.cbar-track {
		height: 5px;
		background: var(--border);
		border-radius: 3px;
		overflow: hidden;
	}

	.cbar-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 3px;
		transition: width 0.4s ease;
	}

	.cbar-val {
		font-size: 0.78rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		text-align: right;
	}

	// ── Judge chips ───────────────────────────────────────────────
	.judge-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.judge-chip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.75rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 20px;
		text-decoration: none;
		transition: border-color 0.12s, background 0.12s;

		&:hover {
			border-color: var(--accent-light);
			background: var(--accent-faint);
			text-decoration: none;
		}
	}

	.judge-chip-name {
		font-size: 0.75rem;
		color: var(--text-muted);
		font-family: var(--font-mono);
	}

	.judge-chip-score {
		font-size: 0.78rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
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
		padding: 0.4rem 1rem;
		border: none;
		background: transparent;
		font-size: 0.8rem;
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

	// ── ELO Stats ────────────────────────────────────────────────
	.elo-stats {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1rem;
	}

	.elo-record {
		font-size: 0.72rem;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.elo-bar-wrap {
		margin-top: 0.5rem;
	}
</style>
