<script lang="ts">
	import Breadcrumb from '$lib/Breadcrumb.svelte';
	import { fmt, formatCriterionName, pct } from '$lib/utils.js';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	let activeTab = $state<'reasoning' | 'response'>('reasoning');

	const criteriaMap = $derived(
		Object.fromEntries((data.taskInfo.criteria ?? []).map((c) => [c.name, c]))
	);
</script>

<svelte:head>
	<title>{data.modelId} · {data.displayName} · {data.judgeId} — Evaluation</title>
</svelte:head>

<Breadcrumb items={[
	{ label: 'Leaderboard', href: '/' },
	{ label: data.displayName, href: `/task/${data.task}` },
	{ label: data.modelId, href: `/model/${data.modelDir}` },
	{ label: data.judgeId }
]} />

<!-- ── Header ────────────────────────────────────────────────── -->
<header class="eval-header">
	<div class="eval-ids">
		<div class="eval-id-block">
			<span class="eval-id-label">Model</span>
			<a href="/model/{data.modelDir}" class="eval-id-value model">{data.modelId}</a>
		</div>
		<div class="eval-id-sep">judged by</div>
		<div class="eval-id-block">
			<span class="eval-id-label">Judge</span>
			<span class="eval-id-value judge">{data.judgeId}</span>
		</div>
		<div class="eval-id-sep">on</div>
		<div class="eval-id-block">
			<span class="eval-id-label">Task</span>
			<a href="/task/{data.task}" class="eval-id-value task">{data.displayName}</a>
		</div>
	</div>

	<div class="eval-score-hero">
		<span class="eval-score-num">{fmt(data.evaluation.avgScore)}</span>
		<span class="eval-score-label">/ 100</span>
	</div>
</header>

<!-- ── Criterion Scores ───────────────────────────────────────── -->
<section class="scores-section">
	<h2 class="section-label">Criterion Scores</h2>
	<div class="score-cards">
		{#each Object.entries(data.evaluation.scores) as [criterion, score]}
			{@const info = criteriaMap[criterion]}
			<div class="score-card">
				<div class="score-card-header">
					<span class="score-card-name">{formatCriterionName(criterion)}</span>
					<span class="score-card-val">{score}</span>
				</div>
				<div class="score-card-bar">
					<div class="score-card-fill" style="width: {pct(score)}%"></div>
				</div>
				{#if info?.description}
					<p class="score-card-desc">{info.description}</p>
				{/if}
			</div>
		{/each}
	</div>
</section>

<!-- ── Tabs: Reasoning | Response ────────────────────────────── -->
<section class="content-section">
	<div class="tab-bar">
		<button
			class="tab-btn"
			class:active={activeTab === 'reasoning'}
			onclick={() => (activeTab = 'reasoning')}
		>
			Judge Reasoning
		</button>
		<button
			class="tab-btn"
			class:active={activeTab === 'response'}
			onclick={() => (activeTab = 'response')}
		>
			Model Response
		</button>
	</div>

	{#if activeTab === 'reasoning'}
		<div class="reasoning-card">
			<div class="reasoning-badge">
				<span class="reasoning-badge-icon">◈</span>
				{data.judgeId}
			</div>
			<div class="prose reasoning-content">{@html data.reasoningHtml}</div>
		</div>
	{:else}
		<div class="response-card">
			{#if data.responseHtml}
				<div class="prose response-content">
					{@html data.responseHtml}
				</div>
			{:else}
				<p class="no-response">Response not available.</p>
			{/if}
		</div>
	{/if}
</section>

<style lang="scss">
	// ── Eval header ───────────────────────────────────────────────
	.eval-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 2rem;
		margin-bottom: 2.5rem;
		flex-wrap: wrap;
	}

	.eval-ids {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.eval-id-block {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.eval-id-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-faint);
	}

	.eval-id-value {
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;

		&.model {
			font-family: var(--font-mono);
			color: var(--accent);
			&:hover { text-decoration: underline; }
		}

		&.judge {
			font-family: var(--font-mono);
			color: var(--text-muted);
		}

		&.task {
			color: var(--text);
			&:hover { color: var(--accent); text-decoration: none; }
		}
	}

	.eval-id-sep {
		font-size: 0.75rem;
		color: var(--text-faint);
		padding-top: 1.1rem;
	}

	.eval-score-hero {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
	}

	.eval-score-num {
		font-size: 3rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		letter-spacing: -0.04em;
		line-height: 1;
	}

	.eval-score-label {
		font-size: 1.1rem;
		color: var(--text-faint);
		font-weight: 400;
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

	// ── Score cards ───────────────────────────────────────────────
	.scores-section {
		margin-bottom: 2.5rem;
	}

	.score-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 0.75rem;
	}

	.score-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.125rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.score-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.score-card-name {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text);
		text-transform: capitalize;
	}

	.score-card-val {
		font-size: 1.15rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--accent);
	}

	.score-card-bar {
		height: 5px;
		background: var(--border);
		border-radius: 3px;
		overflow: hidden;
	}

	.score-card-fill {
		height: 100%;
		background: var(--accent);
		border-radius: 3px;
		transition: width 0.4s ease;
	}

	.score-card-desc {
		font-size: 0.78rem;
		color: var(--text-faint);
		line-height: 1.5;
	}

	// ── Content section ───────────────────────────────────────────
	.content-section {
		margin-bottom: 2rem;
	}

	.tab-bar {
		display: flex;
		gap: 0;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1.5rem;
	}

	.tab-btn {
		padding: 0.6rem 1.25rem;
		font-size: 0.85rem;
		font-weight: 500;
		font-family: var(--font);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: color 0.12s, border-color 0.12s;
		margin-bottom: -1px;

		&:hover {
			color: var(--text);
		}

		&.active {
			color: var(--accent);
			border-bottom-color: var(--accent);
		}
	}

	// ── Reasoning ─────────────────────────────────────────────────
	.reasoning-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.75rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.reasoning-badge {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		font-family: var(--font-mono);
		font-weight: 500;
		color: var(--text-muted);
	}

	.reasoning-badge-icon {
		color: var(--accent);
		font-size: 0.85rem;
	}

	.reasoning-content {
		word-break: break-word;
	}

	// ── Response ──────────────────────────────────────────────────
	.response-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem 2.5rem;
	}

	.no-response {
		color: var(--text-faint);
		font-style: italic;
	}
</style>
