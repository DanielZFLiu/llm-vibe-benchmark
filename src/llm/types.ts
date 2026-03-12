export const MODEL_PROVIDERS = ["openrouter", "ollama"] as const;

export type LlmProvider = typeof MODEL_PROVIDERS[number];

export type ChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

export type StructuredOutputSchema = {
    name: string;
    description?: string;
    schema: Record<string, unknown>;
};
