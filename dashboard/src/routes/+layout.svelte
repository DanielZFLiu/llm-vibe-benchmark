<script lang="ts">
	import '../app.scss';
	import { page } from '$app/stores';

	let { children } = $props();
</script>

<div class="app">
	<header class="nav">
		<div class="nav-inner">
			<a href="/" class="nav-brand">
				<span class="nav-brand-icon">◈</span>
				<span class="nav-brand-name">LLM Vibe Benchmark</span>
			</a>
			<nav class="nav-links">
				<a href="/" class:active={$page.url.pathname === '/'}>Leaderboard</a>
			</nav>
		</div>
	</header>

	<main class="main">
		{@render children()}
	</main>

	<footer class="footer">
		<div class="footer-inner">
			<span>LLM Vibe Benchmark</span>
			<span class="sep">·</span>
			<span>Scores averaged across all judges and criteria</span>
		</div>
	</footer>
</div>

<style lang="scss">
	.app {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	// ── Nav ────────────────────────────────────────────────────────
	.nav {
		position: sticky;
		top: 0;
		z-index: 100;
		background: rgba(247, 247, 245, 0.92);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border-bottom: 1px solid var(--border);
		height: var(--nav-height);
	}

	.nav-inner {
		max-width: var(--max-width);
		margin: 0 auto;
		padding: 0 2rem;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
	}

	.nav-brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text);
		font-weight: 600;
		font-size: 0.95rem;
		letter-spacing: -0.01em;
		text-decoration: none;

		&:hover {
			color: var(--text);
			text-decoration: none;

			.nav-brand-icon {
				color: var(--accent);
			}
		}
	}

	.nav-brand-icon {
		font-size: 1.1rem;
		color: var(--accent);
		transition: color 0.15s;
		line-height: 1;
	}

	.nav-links {
		display: flex;
		align-items: center;
		gap: 0.25rem;

		a {
			color: var(--text-muted);
			font-size: 0.875rem;
			font-weight: 500;
			padding: 0.3rem 0.75rem;
			border-radius: var(--radius-sm);
			transition: color 0.15s, background 0.15s;
			text-decoration: none;

			&:hover {
				color: var(--text);
				background: var(--surface-hover);
				text-decoration: none;
			}

			&.active {
				color: var(--accent);
				background: var(--accent-faint);
			}
		}
	}

	// ── Main ───────────────────────────────────────────────────────
	.main {
		flex: 1;
		max-width: var(--max-width);
		width: 100%;
		margin: 0 auto;
		padding: 2.5rem 2rem 4rem;
	}

	// ── Footer ─────────────────────────────────────────────────────
	.footer {
		border-top: 1px solid var(--border);
		padding: 1.25rem 2rem;
	}

	.footer-inner {
		max-width: var(--max-width);
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: var(--text-faint);
	}

	.sep {
		opacity: 0.5;
	}
</style>
