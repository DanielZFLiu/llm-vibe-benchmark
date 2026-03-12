import { getOllamaBaseUrl } from "../config.js";
import { type ChatMessage, type StructuredOutputSchema } from "./types.js";

type OllamaChatResponse = {
    message?: {
        content?: string;
    };
    error?: string;
};

export async function chatWithOllama(
    model: string,
    messages: ChatMessage[],
    maxTokens?: number,
): Promise<string> {
    const response = await fetch(buildOllamaChatUrl(), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            messages,
            stream: false,
            ...(maxTokens !== undefined && { options: { num_predict: maxTokens } }),
        }),
    });

    return extractOllamaContent(response, model);
}

export async function chatWithOllamaStructured<T>(
    model: string,
    messages: ChatMessage[],
    outputSchema: StructuredOutputSchema,
    maxTokens?: number,
): Promise<T> {
    const response = await fetch(buildOllamaChatUrl(), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            messages,
            stream: false,
            format: outputSchema.schema,
            ...(maxTokens !== undefined && { options: { num_predict: maxTokens } }),
        }),
    });

    const content = await extractOllamaContent(response, model);

    try {
        return JSON.parse(content) as T;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const preview = content.slice(0, 300).replace(/\s+/g, " ");
        throw new Error(
            `Invalid structured JSON from ${model}: ${message}. Response preview: ${preview}`,
        );
    }
}

function buildOllamaChatUrl(): string {
    return new URL("/api/chat", getOllamaBaseUrl()).toString();
}

async function extractOllamaContent(
    response: Response,
    model: string,
): Promise<string> {
    const bodyText = await response.text();
    let parsed: OllamaChatResponse;

    try {
        parsed = JSON.parse(bodyText) as OllamaChatResponse;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const preview = bodyText.slice(0, 300).replace(/\s+/g, " ");
        throw new Error(
            `Invalid Ollama response from ${model}: ${message}. Response preview: ${preview}`,
        );
    }

    if (!response.ok) {
        throw new Error(
            `Ollama request failed for ${model}: ${parsed.error ?? response.statusText}`,
        );
    }

    const content = parsed.message?.content?.trim();
    if (!content) {
        throw new Error(`Empty response from ${model}`);
    }

    return content;
}
