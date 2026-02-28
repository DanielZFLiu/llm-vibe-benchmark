# LLM Vibe Benchmark — Dashboard

A minimalist SvelteKit dashboard for exploring benchmark evaluations, model responses, and judge reasoning.

## Quick Start

```bash
cd dashboard
npm install
npm run dev
```

Then open **http://localhost:5173** (or the port shown in your terminal).

## Pages

| Route | Description |
|---|---|
| `/` | Leaderboard — ranked models with score bars and per-task matrix |
| `/task/[task]` | Task detail — prompt (rendered as markdown), criteria, all model scores per criterion |
| `/model/[modelDir]` | Model detail — per-task scores and all judge evaluations |
| `/model/[modelDir]/response/[task]` | Full model response rendered as markdown |
| `/eval/[task]/[modelDir]/[judgeDir]` | Single evaluation — criterion scores, judge reasoning (rendered as markdown), model response |

## Stack

- **SvelteKit 2** + **Svelte 5** (runes)
- **SCSS** for scoped and global styles
- **TypeScript** throughout
- **marked** for markdown rendering (task prompts, judge reasoning, model responses)
- Reads data paths from `../benchmark.config.json`; falls back to `../evaluations/`, `../responses/`, `../tasks/`
