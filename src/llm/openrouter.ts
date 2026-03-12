import { OpenRouter } from "@openrouter/sdk";
import { getOpenRouterApiKey } from "../config.js";
import { type ChatMessage, type StructuredOutputSchema } from "./types.js";

let clientInstance: OpenRouter | null = null;

function getClient(): OpenRouter {
    if (!clientInstance) {
        clientInstance = new OpenRouter({
            apiKey: getOpenRouterApiKey(),
        });
    }
    return clientInstance;
}

export async function chatWithOpenRouter(
    model: string,
    messages: ChatMessage[],
    maxTokens?: number,
): Promise<string> {
    const client = getClient();
    const completion = await client.chat.send({
        model,
        messages,
        stream: false,
        ...(maxTokens !== undefined && { max_tokens: maxTokens }),
    });
    return extractCompletionContent(completion.choices[0]?.message?.content, model);
}

export async function chatWithOpenRouterStructured<T>(
    model: string,
    messages: ChatMessage[],
    outputSchema: StructuredOutputSchema,
    maxTokens?: number,
): Promise<T> {
    const client = getClient();
    const completion = await client.chat.send({
        model,
        messages,
        stream: false,
        responseFormat: {
            type: "json_schema",
            jsonSchema: {
                name: outputSchema.name,
                description: outputSchema.description,
                schema: outputSchema.schema,
                strict: true,
            },
        },
        ...(maxTokens !== undefined && { max_tokens: maxTokens }),
    });
    const content = extractCompletionContent(
        completion.choices[0]?.message?.content,
        model,
    );

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

function extractCompletionContent(raw: unknown, model: string): string {
    if (raw == null) {
        throw new Error(`Empty response from ${model}`);
    }

    let content = "";
    if (typeof raw === "string") {
        content = raw;
    } else if (Array.isArray(raw)) {
        content = raw.map((item) => {
            if (
                item
                && typeof item === "object"
                && "text" in item
                && typeof item.text === "string"
            ) {
                return item.text;
            }
            return "";
        }).join("");
    }

    if (!content) {
        throw new Error(`Empty response from ${model}`);
    }

    return content;
}
