<script lang="ts">
	import Breadcrumb from '$lib/Breadcrumb.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.modelId} · {data.displayName} — Response</title>
</svelte:head>

<Breadcrumb items={[
	{ label: 'Leaderboard', href: '/' },
	{ label: data.modelId, href: `/model/${data.modelDir}` },
	{ label: data.displayName, href: `/task/${data.task}` },
	{ label: 'Response' }
]} />

<header class="page-header">
	<h1 class="page-title">Response</h1>
	<div class="page-meta">
		<span class="meta-tag model">{data.modelId}</span>
		<span class="meta-sep">on</span>
		<span class="meta-tag task">{data.displayName}</span>
	</div>
</header>

<div class="response-card">
	<div class="prose response-content">
		{@html data.responseHtml}
	</div>
</div>

<style lang="scss">
	.page-header {
		margin-bottom: 2rem;
	}

	.page-title {
		font-size: 1.75rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		margin-bottom: 0.75rem;
	}

	.page-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.825rem;
	}

	.meta-tag {
		display: inline-block;
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-sm);
		font-weight: 500;

		&.model {
			background: var(--accent-faint);
			color: var(--accent);
			border: 1px solid var(--accent-light);
			font-family: var(--font-mono);
			font-size: 0.78rem;
		}

		&.task {
			background: var(--surface-hover);
			color: var(--text-muted);
			border: 1px solid var(--border);
		}
	}

	.meta-sep {
		color: var(--text-faint);
	}

	.response-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem 2.5rem;
	}
</style>
