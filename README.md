# ◈ LLM Vibe Benchmark

A typescript framework for evaluating LLMs on a vibe basis - quality, organization, best practices, and anything you so desire - across any type of task.

## How It Works

- **Set C (Competitors):** Models being benchmarked.
- **Set J (Judges):** Frontier models that score the responses.
- All API calls go through [OpenRouter](https://openrouter.ai) for unified model access.

### Pipeline

1. **Generate** — Each Set C model responds to every task in `tasks/`.
2. **Evaluate** — Each Set J judge scores each response (0–100) per criterion.
3. **Report** — Scores are averaged across judges and criteria, printed, and saved.

## Quick Start

```bash
npm install
cp .env.example .env       # add your OPENROUTER_API_KEY
npm run build
node dist/index.js run     # generate → evaluate → report
```

### CLI Commands

```
node dist/index.js generate   # generate responses from Set C
node dist/index.js evaluate   # have Set J score all responses
node dist/index.js report     # print the leaderboard
node dist/index.js run        # all three in sequence
```

### Options

```
--tasks <t1,t2,...>    Only run the specified task names (comma-separated)
--models <m1,m2,...>   Only run the specified Set C models (comma-separated, partial match)
--force                Overwrite existing outputs instead of skipping them
```

Examples:
```bash
# Run only one task end-to-end
node dist/index.js run --tasks relay_webhook_api

# Re-run a task you already ran (overwrite previous responses and evaluations)
node dist/index.js run --tasks secret_society_chat --force

# Generate for multiple specific tasks
node dist/index.js generate --tasks relay_webhook_api,secret_society_chat

# Run only specific models (partial match — "deepseek" matches "deepseek/deepseek-v3.2")
node dist/index.js run --models deepseek,qwen

# Combine filters: one model, one task
node dist/index.js run --tasks relay_webhook_api --models step-3.5
```

## Dashboard

A sveltekit dashboard for browsing results interactively.

```bash
cd dashboard
npm install
npm run dev      # http://localhost:5173
```

## Configuration

Edit `benchmark.config.json`:

```json
{
  "setC": ["deepseek/deepseek-v3.2", "qwen/qwen3.5-397b-a17b"],
  "setJ": ["openai/gpt-5.3-codex", "anthropic/claude-opus-4.6"],
  "tasksDir": "./tasks",
  "responsesDir": "./responses",
  "evaluationsDir": "./evaluations",
  "maxConcurrency": 3,
  "maxTokens": 32768
}
```

| Field | Default | Description |
|---|---|---|
| `setC` | — | Competitor model IDs (OpenRouter format) |
| `setJ` | — | Judge model IDs |
| `tasksDir` | `./tasks` | Where task folders live |
| `responsesDir` | `./responses` | Where generated responses are saved |
| `evaluationsDir` | `./evaluations` | Where judge scores and `results.json` are saved |
| `maxConcurrency` | `3` | Max parallel API calls |
| `maxTokens` | `16384` | Default max output tokens per generation call — can be overridden per task in `task.json` |

## Output Files

After running, these types of output are saved:

- **`responses/<model>/<task>.md`** — Raw response from each competitor model.
- **`evaluations/<task>/<model>__<judge>.json`** — Per-judge score file with reasoning and per-criterion scores.
- **`evaluations/results.json`** — Aggregated leaderboard. Re-running `report` **merges** new results in. Newest data wins on conflict.

## Adding Tasks

Drop a folder into `tasks/` with a `prompt.txt`:

```
tasks/
├── my_task/
│   ├── prompt.txt          # required
│   ├── criteria.json       # optional: override default rubric
│   └── task.json           # optional: per-task settings (see below)
```

### Per-Task Settings (`task.json`)

Add a `task.json` to any task folder to override global settings for that task:

```json
{
  "maxTokens": 32768,
  "systemPrompt": "Introduce each file with `### File: <relative-path>` followed by a fenced code block."
}
```

| Field | Description |
|---|---|
| `maxTokens` | Overrides the global `maxTokens` for generation calls on this task. |
| `systemPrompt` | Injected as a `system` role message before the task prompt in all competitor generation calls. Use this to enforce consistent output formatting (e.g. file headers for multi-file implementations). When set, judges are also automatically notified that the response is a structured multi-file implementation. |

### Default Criteria

Used when no `criteria.json` is present:

| Criterion | Description |
|---|---|
| **Completeness** | Does the response fully address the task? |
| **Richness** | Does it explain reasoning, trade-offs, or usage? |
| **Organization** | Is the output well-structured and easy to follow? |
| **Best Practices** | Does it follow modern conventions for the domain? |

### Custom Criteria

Add a `criteria.json` to any task folder. Optional `rubric` field anchors scoring and counters judge score clustering:

```json
{
  "criteria": [
    {
      "name": "correctness",
      "description": "Does the code run without errors?",
      "rubric": "90-100: flawless. 50-70: minor bugs. 0-30: does not run."
    },
    { "name": "clarity", "description": "Is the explanation easy to follow?" }
  ]
}
```

## Included Tasks

| Task | Type | Description |
|---|---|---|
| `secret_society_chat` | System design | Design a self-hosted, invite-only, E2E encrypted chat app for ~1,000 users |
| `relay_webhook_api` | Programming (C#) | Build a webhook fan-out service in ASP.NET Core 10 (Minimal APIs, EF Core, resilience, background delivery) |
| `react_kanban_board` | Programming (React/TS) | Build an interactive Kanban board SPA with drag-and-drop, filters, undo, and localStorage persistence |
| `log_analysis_cli` | Programming (Python) | Build a streaming CLI log analyzer with filters, aggregations, and file tailing |

## Leaderboard Output

```
Rank  Model                   Avg Score  Std Dev   Best Task           Worst Task
----  -----                   ---------  -------   ---------           ----------
#1    deepseek-v3.2           88.2       4.1       relay_webhook_api   secret_society
#2    qwen3.5-397b            85.7       6.3       secret_society      relay_webhook_api
```

A per-task breakdown table is also printed below the leaderboard.

## Testing

```bash
npm test              # single run
npm run test:watch    # watch mode
```