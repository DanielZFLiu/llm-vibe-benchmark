import {
    chatWithOpenRouter,
    chatWithOpenRouterStructured,
} from "./openrouter.js";
import {
    chatWithOllama,
    chatWithOllamaStructured,
} from "./ollama.js";
import {
    type ChatMessage,
    type LlmProvider,
    type StructuredOutputSchema,
} from "./types.js";

export { MODEL_PROVIDERS } from "./types.js";
export type { ChatMessage, LlmProvider, StructuredOutputSchema } from "./types.js";

export async function chatCompletion(
    provider: LlmProvider,
    model: string,
    messages: ChatMessage[],
    maxTokens?: number,
): Promise<string> {
    switch (provider) {
        case "openrouter":
            return chatWithOpenRouter(model, messages, maxTokens);
        case "ollama":
            return chatWithOllama(model, messages, maxTokens);
    }
}

export async function chatCompletionStructured<T>(
    provider: LlmProvider,
    model: string,
    messages: ChatMessage[],
    outputSchema: StructuredOutputSchema,
    maxTokens?: number,
): Promise<T> {
    switch (provider) {
        case "openrouter":
            return chatWithOpenRouterStructured<T>(
                model,
                messages,
                outputSchema,
                maxTokens,
            );
        case "ollama":
            return chatWithOllamaStructured<T>(
                model,
                messages,
                outputSchema,
                maxTokens,
            );
    }
}
