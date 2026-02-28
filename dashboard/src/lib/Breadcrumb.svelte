<script lang="ts">
	interface BreadcrumbItem {
		label: string;
		href?: string;
	}

	let { items }: { items: BreadcrumbItem[] } = $props();
</script>

<nav class="breadcrumb">
	{#each items as item, i}
		{#if i > 0}<span class="sep">›</span>{/if}
		{#if item.href}
			<a href={item.href}>{item.label}</a>
		{:else}
			<span>{item.label}</span>
		{/if}
	{/each}
</nav>

<style lang="scss">
	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: var(--text-faint);
		margin-bottom: 1.75rem;
		flex-wrap: wrap;

		a {
			color: var(--text-muted);
			text-decoration: none;
			&:hover { color: var(--accent); }
		}

		.sep { opacity: 0.4; }
	}
</style>
