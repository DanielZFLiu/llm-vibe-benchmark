import { OpenRouter } from "@openrouter/sdk";
import { mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { getApiKey } from "./config.js";

let clientInstance: OpenRouter | null = null;

export function getClient(): OpenRouter {
    if (!clientInstance) {
        clientInstance = new OpenRouter({
            apiKey: getApiKey(),
        });
    }
    return clientInstance;
}

export async function chatCompletion(
    model: string,
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    maxTokens?: number,
): Promise<string> {
    const client = getClient();
    const completion = await client.chat.send({
        model,
        messages,
        stream: false,
        ...(maxTokens !== undefined && { max_tokens: maxTokens }),
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
        throw new Error(`Empty response from ${model}`);
    }
    const content =
        typeof raw === "string"
            ? raw
            : raw.map((item) => ("text" in item ? item.text : "")).join("");
    if (!content) {
        throw new Error(`Empty response from ${model}`);
    }
    return content;
}

export function ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
    }
}

export function discoverTasks(tasksDir: string): string[] {
    if (!existsSync(tasksDir)) {
        throw new Error(`Tasks directory not found: ${tasksDir}`);
    }

    const entries = readdirSync(tasksDir, { withFileTypes: true });
    const tasks: string[] = [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const promptPath = resolve(tasksDir, entry.name, "prompt.txt");
            if (existsSync(promptPath)) {
                tasks.push(entry.name);
            } else {
                console.warn(`Skipping ${entry.name}: no prompt.txt found`);
            }
        }
    }

    if (tasks.length === 0) {
        throw new Error(`No valid tasks found in ${tasksDir}`);
    }

    return tasks.sort();
}

export function readPrompt(tasksDir: string, taskName: string): string {
    const promptPath = resolve(tasksDir, taskName, "prompt.txt");
    return readFileSync(promptPath, "utf-8").trim();
}

export function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    retries: number = 3,
    delayMs: number = 2000,
    onWarn?: (message: string) => void,
): Promise<T> {
    let lastError: Error | undefined;
    const warn = onWarn ?? ((msg: string) => console.warn(msg));
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < retries) {
                warn(
                    `  Attempt ${attempt}/${retries} failed: ${lastError.message}. Retrying in ${delayMs}ms...`,
                );
                await sleep(delayMs);
            }
        }
    }
    throw lastError!;
}

export function sanitizeModelName(model: string): string {
    return model.replace(/\//g, "__");
}

export async function runConcurrent<T>(
    queue: T[],
    maxConcurrency: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let index = 0;
    const workers = Array.from(
        { length: Math.min(maxConcurrency, queue.length) },
        async () => {
            while (index < queue.length) {
                const current = queue[index++];
                if (!current) break;
                await worker(current);
            }
        },
    );
    await Promise.all(workers);
}
