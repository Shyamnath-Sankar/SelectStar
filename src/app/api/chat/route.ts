/**
 * POST /api/chat  (Server-Sent Events stream)
 *
 * Runs one agent turn and streams events to the frontend as they happen:
 *   step → sql → canvas* → token* → reply_done → done
 *
 * The frontend reads this with a fetch-streaming pattern (the native
 * EventSource API only supports GET, so we POST and parse the SSE body).
 */
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { loadSessionState, saveMessage, saveCanvasObject, toAgentState } from "@/lib/session";
import { runTurn } from "@/lib/agents/orchestrator";
import type { ChatRequest, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }
  if (!body.sessionId || !body.message?.trim()) {
    return new Response("sessionId and message are required.", { status: 400 });
  }

  const sessionState = await loadSessionState(body.sessionId);
  if (!sessionState) {
    return new Response("Session not found.", { status: 404 });
  }

  // Persist the user's message immediately.
  const userMessage = body.message.trim();
  await saveMessage(body.sessionId, "user", userMessage);

  // Turn index = number of prior user messages + 1 (this one).
  const priorUserCount = sessionState.messages.filter((m) => m.role === "user").length;
  const turn = priorUserCount + 1;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let order = 0;
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const agentState = toAgentState(sessionState, userMessage);

        const finalState = await runTurn(agentState, {
          emit: send,
          onCanvas: async (obj) => {
            await saveCanvasObject(body.sessionId, turn, order, obj);
            order += 1;
          },
          onStatePatch: () => {
            /* state changes are reflected via canvas/sql stream events */
          },
        });

        // Persist the assistant reply + any pending-write metadata.
        if (finalState.reply) {
          await saveMessage(body.sessionId, "assistant", finalState.reply, {
            agents: finalState.routedAgents,
            steps: finalState.steps,
            pendingWrite: finalState.pendingWrite ?? undefined,
          });
        }

        // If a pending write was created, mirror it onto the session row so the
        // confirm-write route can look it up.
        if (finalState.pendingWrite) {
          await db.session.update({
            where: { id: body.sessionId },
            data: { /* zenMode stays as-is; pendingWrite is held in message meta */ },
          });
        }
      } catch (e) {
        const message = (e as Error).message || String(e);
        send({ type: "error", message });
        await saveMessage(body.sessionId, "assistant", `⚠️ Something went wrong: ${message}`, { error: true });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
