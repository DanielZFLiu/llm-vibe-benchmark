import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
    BenchmarkConfigSchema,
    TaskCriteriaSchema,
    TaskSettingsSchema,
    DEFAULT_CRITERIA,
    type BenchmarkConfig,
    type Criterion,
    type TaskSettings,
} from "./schemas.js";

const CONFIG_FILENAME = "benchmark.config.json";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export function loadConfig(rootDir: string): BenchmarkConfig {
    const configPath = resolve(rootDir, CONFIG_FILENAME);

    if (!existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }

    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const result = BenchmarkConfigSchema.safeParse(raw);

    if (!result.success) {
        throw new Error(
            `Invalid config in ${CONFIG_FILENAME}:\n${result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
        );
    }

    return result.data;
}

export function getOpenRouterApiKey(): string {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
        throw new Error(
            "OPENROUTER_API_KEY environment variable is not set. See .env.example.",
        );
    }
    return key;
}

export function getApiKey(): string {
    return getOpenRouterApiKey();
}

export function getOllamaBaseUrl(): string {
    return process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
}

export function loadTaskCriteria(taskDir: string): Criterion[] {
    const criteriaPath = resolve(taskDir, "criteria.json");

    if (!existsSync(criteriaPath)) {
        return DEFAULT_CRITERIA;
    }

    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(criteriaPath, "utf-8"));
    } catch {
        console.warn(
            `Malformed JSON in ${criteriaPath}, falling back to defaults.`,
        );
        return DEFAULT_CRITERIA;
    }

    const result = TaskCriteriaSchema.safeParse(raw);

    if (!result.success) {
        console.warn(
            `Invalid criteria.json in ${taskDir}, falling back to defaults:\n${result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
        );
        return DEFAULT_CRITERIA;
    }

    return result.data.criteria;
}

export function loadTaskConfig(taskDir: string): TaskSettings | null {
    const configPath = resolve(taskDir, "task.json");

    if (!existsSync(configPath)) {
        return null;
    }

    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
        console.warn(
            `Malformed JSON in ${configPath}, ignoring task settings.`,
        );
        return null;
    }

    const result = TaskSettingsSchema.safeParse(raw);

    if (!result.success) {
        console.warn(
            `Invalid task.json in ${taskDir}, ignoring task settings:\n${result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
        );
        return null;
    }

    return result.data;
}
