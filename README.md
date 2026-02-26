# LLM Vibe Benchmark

A TypeScript framework for evaluating LLMs on a "vibe" basis — quality, organization, best practices, and more — across any type of task.

## How It Works

- **Set C (Competitors):** Models being benchmarked.
- **Set J (Judges):** Frontier models that score the responses. Separated from competitors to avoid bias.
- All API calls go through [OpenRouter](https://openrouter.ai) for unified model access.

### Pipeline

1. **Generate** — Each Set C model responds to every task in `tasks/`.
2. **Anonymize** — Model self-identifiers are stripped before judging.
3. **Evaluate** — Each Set J judge scores each response (0–100) per criterion with chain-of-thought reasoning.
4. **Report** — Scores are averaged across judges and criteria to produce a leaderboard.

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

## Configuration

Edit `benchmark.config.json`:

```json
{
  "setC": ["openai/gpt-5.2", "anthropic/claude-3.5-sonnet"],
  "setJ": ["openai/gpt-5.3-codex", "anthropic/claude-3.6-opus"],
  "tasksDir": "./tasks",
  "responsesDir": "./responses",
  "evaluationsDir": "./evaluations",
  "maxConcurrency": 3
}
```

## Adding Tasks

Drop a folder into `tasks/` with a `prompt.txt`:

```
tasks/
├── build_a_snake_game/
│   ├── prompt.txt          # required
│   └── criteria.json       # optional: override default rubric
└── summarize_article/
    └── prompt.txt
```

### Default Criteria

Used when no `criteria.json` is present:

| Criterion | Description |
|---|---|
| **Completeness** | Does the response fully address the task? |
| **Richness** | Does it explain reasoning, trade-offs, or usage? |
| **Organization** | Is the output well-structured and easy to follow? |
| **Best Practices** | Does it follow modern conventions for the domain? |

### Custom Criteria

Add a `criteria.json` to any task folder. Optional `rubric` field anchors scoring:

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

## Leaderboard Output

```
Rank  Model                   Avg Score  Std Dev   Best Task           Worst Task
----  -----                   ---------  -------   ---------           ----------
#1    claude-3.5-sonnet       88.2       4.1       snake_game          summarize
#2    gpt-5.2                 87.5       12.3      summarize           snake_game
```

## Key Design Decisions

- **Resumable** — Skips tasks/evaluations where output files already exist.
- **Retries** — Malformed judge output is retried up to 3 times (Zod-validated).
- **Concurrency** — Configurable via `maxConcurrency`.
- **Anonymization** — Model identity strings are stripped before judging.

## Testing

```bash
npm test              # single run
npm run test:watch    # watch mode
```