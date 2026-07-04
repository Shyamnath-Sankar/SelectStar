/**
 * Single shared LLM client wrapper.
 *
 * Per spec §3: "Every agent's LLM calls must go through one shared client
 * wrapper — never instantiate the client ad hoc inside an agent."
 *
 * This wrapper uses z-ai-web-dev-sdk, which is an OpenAI-compatible client.
 * Swapping in any other OpenAI-compatible provider (OpenAI itself, vLLM,
 * Ollama, LM Studio) only requires pointing this wrapper at a different
 * base_url + api_key + model triple.
 */
import ZAI from "z-ai-web-dev-sdk";

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function client() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
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
 * Uses the 'assistant' role convention for system prompts (per the SDK docs).
 */
export async function complete(
  messages: ChatMessage[],
  opts: LlmOptions = {}
): Promise<string> {
  const zai = await client();
  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    thinking: { type: opts.thinking ? "enabled" : "disabled" },
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  });
  return completion.choices[0]?.message?.content ?? "";
}

/**
 * Streaming completion. Calls `onToken` for each text delta and resolves
 * with the full text. Used by the synthesis node to stream the final reply
 * token-by-token into the chat pane (spec §8 streaming feel).
 *
 * NOTE: z-ai-web-dev-sdk's `stream: true` doesn't yield OpenAI-style delta
 * chunks reliably, so we use the non-streaming `complete()` and re-chunk the
 * result into small pseudo-tokens emitted with a tiny delay. This preserves
 * the live "typing" feel in the UI while staying robust.
 */
export async function completeStream(
  messages: ChatMessage[],
  onToken: (delta: string) => void,
  opts: LlmOptions = {}
): Promise<string> {
  const full = await complete(messages, opts);
  if (!full) return "";

  // Re-chunk into ~3-word pseudo-tokens for a natural typing cadence.
  const tokens = chunkText(full, 3);
  for (const tok of tokens) {
    onToken(tok);
    // Tiny yield so the browser can paint between batches — feels live
    // without adding meaningful latency.
    await new Promise((r) => setTimeout(r, 12));
  }
  return full;
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
