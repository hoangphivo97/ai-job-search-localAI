import * as dotenv from 'dotenv';

dotenv.config();

const BASE_URL: string = (process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:5001/v1").replace(/\/+$/, "");
const MODEL_NAME: string = process.env.LOCAL_AI_MODEL || "qwen2.5-coder";
const TIMEOUT_MS: number = parseInt(process.env.LOCAL_AI_TIMEOUT || "180", 10) * 1000;
const TEMPERATURE: number = parseFloat(process.env.LOCAL_AI_TEMPERATURE || "0.2");

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface ChatPayload {
    model: string;
    messages: ChatMessage[];
    temperature: number;
    max_tokens: number;
    response_format?: { type: string };
}

export async function callLocalChat(
    systemPrompt: string, 
    userPrompt: string, 
    jsonMode: boolean = false
): Promise<string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json"
    };

    const payload: ChatPayload = {
        model: MODEL_NAME,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        temperature: TEMPERATURE,
        max_tokens: 4096
    };

    if (jsonMode) {
        payload.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }

        const data: any = await response.json();
        
        if (!data.choices || data.choices.length === 0 || !data.choices[0].message) {
            throw new Error("Invalid response format received from Local AI server.");
        }

        return data.choices[0].message.content;
    } catch (error: any) {
        if (error.name === 'AbortError') {
            throw new Error(`Request timed out after ${TIMEOUT_MS / 1000} seconds.`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}