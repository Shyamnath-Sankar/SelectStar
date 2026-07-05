/**
 * Single shared LLM client wrapper.
 *
 * Per spec §3: "Every agent's LLM calls must go through one shared client
 * wrapper — never instantiate the client ad hoc inside an agent."
 *
 * This wrapper uses the OpenAI SDK pointed at an OpenAI-compatible provider.
 * The default provider is OpenCode Zen (https://opencode.ai/zen/v1) with the
 * `big-pickle` model. Override via environment variables:
 *
 *   LLM_BASE_URL  — e.g. https://opencode.ai/zen/v1
 *   LLM_API_KEY   — your API key
 *   LLM_MODEL     — e.g. big-pickle
 *
 * Swapping in OpenAI itself, vLLM, Ollama, or LM Studio only requires
 * changing these three values.
 */
import OpenAI from "openai";

const BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const API_KEY = process.env.LLM_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

let _client: OpenAI | null = null;

function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY });
  }
  return _client;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmOptions {
  thinking?: boolean;
  temperature?: number;
  /** Max output tokens, if the provider supports it. */
  maxTokens?: number;
}

/**
 * Single-shot completion. Returns the assistant text.
 *
 * Retries automatically on rate-limit (429) and transient network errors with
 * exponential backoff (1s, 2s, 4s), so a brief rate-limit spike doesn't
 * surface as a hard error to the user.
 */
export async function complete(
  messages: ChatMessage[],
  opts: LlmOptions = {}
): Promise<string> {
  const openai = client();
  const maxRetries = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      });
      return completion.choices[0]?.message?.content ?? "";
    } catch (e) {
      lastError = e;
      const msg = (e as Error).message || String(e);
      const isRateLimit = /429|rate.?limit|too many requests/i.test(msg);
      const isTransient = /ECONNRESET|ETIMEDOUT|fetch failed|network|socket hang up/i.test(
        msg
      );
      if (attempt < maxRetries && (isRateLimit || isTransient)) {
        const delay = Math.min(8000, 1000 * 2 ** attempt) + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

/**
 * Streaming completion. Calls `onToken` for each text delta and resolves
 * with the full text. Used by the synthesis node to stream the final reply
 * token-by-token into the chat pane (spec §8 streaming feel).
 *
 * Uses the OpenAI SDK's native streaming (`stream: true`) which yields
 * real delta chunks. Falls back to non-streaming + pseudo-chunking if the
 * provider rejects streaming.
 */
export async function completeStream(
  messages: ChatMessage[],
  onToken: (delta: string) => void,
  opts: LlmOptions = {}
): Promise<string> {
  const openai = client();
  let full = "";

  try {
    const stream = await openai.chat.completions.create({
      model: MODEL,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onToken(delta);
      }
    }
    return full;
  } catch {
    // Fallback: non-streaming + pseudo-chunked typing feel.
    full = await complete(messages, opts);
    if (!full) return "";
    const tokens = chunkText(full, 3);
    for (const tok of tokens) {
      onToken(tok);
      await new Promise((r) => setTimeout(r, 12));
    }
    return full;
  }
}

/** Split text into chunks of roughly `wordsPerChunk` words, preserving spaces. */
function chunkText(text: string, wordsPerChunk: number): string[] {
  const out: string[] = [];
  const parts = text.split(/(\s+)/); // keep whitespace tokens
  let buf = "";
  let wc = 0;
  for (const p of parts) {
    buf += p;
    if (/\S/.test(p)) wc++;
    if (wc >= wordsPerChunk) {
      out.push(buf);
      buf = "";
      wc = 0;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * Ask the model to return strictly-validated JSON. Strips markdown fences
 * and parses, throwing a clear error if the output isn't valid JSON.
 * Retries once with a corrective nudge if the first parse fails — LLMs
 * occasionally emit slightly malformed JSON (missing colons, trailing commas).
 */
export async function completeJson<T = unknown>(
  messages: ChatMessage[],
  opts: LlmOptions = {}
): Promise<T> {
  const raw = await complete(messages, opts);
  try {
    return parseJsonLoose<T>(raw);
  } catch (firstErr) {
    // Retry once with a stronger instruction and the previous bad output.
    const retry = await complete(
      [
        ...messages,
        { role: "assistant", content: raw },
        {
          role: "user",
          content:
            "That response was not valid JSON. Return ONLY a single valid JSON object now — no prose, no markdown fences, properly quoted keys and values.",
        },
      ],
      { ...opts, temperature: 0 }
    );
    try {
      return parseJsonLoose<T>(retry);
    } catch {
      throw firstErr;
    }
  }
}

export function parseJsonLoose<T = unknown>(raw: string): T {
  let s = raw.trim();
  // Strip ```json ... ``` fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Sometimes models prepend prose; find the first { or [ and last } or ].
  const start = s.search(/[{[]/);
  if (start > 0) s = s.slice(start);
  const lastBrace = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastBrace > -1 && lastBrace < s.length - 1) s = s.slice(0, lastBrace + 1);
  return JSON.parse(s) as T;
}
