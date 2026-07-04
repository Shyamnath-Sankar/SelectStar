"use client";

import type { StreamEvent, AgentName } from "@/lib/types";

/**
 * Posts a chat message and streams SSE events back from /api/chat.
 *
 * We can't use the native EventSource API because it only supports GET and
 * we need to POST the message body. Instead we read the response body as a
 * stream and parse the `data: ...` lines ourselves.
 */
export interface ChatStreamHandlers {
  onStep: (agent: AgentName, label: string) => void;
  onSql: (info: { query: string; executed: boolean; rowCount?: number; durationMs?: number; error?: string }) => void;
  onCanvas: (object: StreamEvent extends { type: "canvas" } ? never : Extract<StreamEvent, { type: "canvas" }>["object"]) => void;
  onToken: (text: string) => void;
  onReplyDone: (reply: string) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export async function streamChat(
  sessionId: string,
  message: string,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    handlers.onError(text || `Request failed (${res.status})`);
    handlers.onDone();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = raw.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(payload) as StreamEvent;
          } catch {
            continue;
          }
          dispatch(event, handlers);
        }
      }
    }
  } finally {
    handlers.onDone();
  }
}

function dispatch(event: StreamEvent, h: ChatStreamHandlers) {
  switch (event.type) {
    case "step":
      h.onStep(event.agent, event.label);
      break;
    case "sql":
      h.onSql(event);
      break;
    case "canvas":
      h.onCanvas(event.object);
      break;
    case "token":
      h.onToken(event.text);
      break;
    case "reply_done":
      h.onReplyDone(event.reply);
      break;
    case "error":
      h.onError(event.message);
      break;
    case "done":
      h.onDone();
      break;
  }
}
