"use client";

import { create } from "zustand";
import type { AppMode, CanvasObject, SchemaSnapshot, AgentName } from "@/lib/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Live streaming flag for the assistant reply currently being produced. */
  streaming?: boolean;
  /** Step labels shown while agents work ("Running query…"). */
  steps?: { agent: AgentName; label: string }[];
  /** Whether this assistant turn ended in an error. */
  isError?: boolean;
  /** Suggested follow-up questions emitted after this assistant reply.
   * Clickable chips rendered under the message bubble. */
  followUps?: string[];
  /** Human-in-the-loop artifacts that render INLINE inside the chat bubble —
   * pending_write and report_plan. These never appear in the canvas pane. */
  inlineArtifacts?: CanvasObject[];
}

export interface PendingWriteState {
  pendingId: string;
  query: string;
  estimatedImpact: string;
  status: "pending" | "confirmed" | "executed" | "rolled_back" | "failed" | "cancelled";
  rowsAffected?: number;
  error?: string;
}

interface SessionStore {
  // Connection / session
  sessionId: string | null;
  mode: AppMode;
  label: string;
  dialect: string;
  schema: SchemaSnapshot | null;
  canWrite: boolean;
  zenMode: boolean;
  connecting: boolean;
  connectError: string | null;
  suggestedQuestions: string[];

  // Chat
  messages: ChatMessage[];
  sending: boolean;
  /** The assistant message id currently streaming. */
  streamingId: string | null;

  // Canvas
  canvas: CanvasObject[];

  // Pending writes awaiting confirmation
  pendingWrites: PendingWriteState[];

  // Audit log
  auditCount: number;

  // Domain template detected after connect (Sales/Marketing/HR/etc.) — null until detected.
  domain: string | null;

  // Actions
  setConnecting: (v: boolean) => void;
  setConnectError: (e: string | null) => void;
  connect: (data: {
    sessionId: string;
    mode?: AppMode;
    label: string;
    dialect: string;
    schema: SchemaSnapshot;
    canWrite: boolean;
    suggestedQuestions: string[];
  }) => void;
  reset: () => void;
  loadSession: (data: {
    sessionId: string;
    mode?: AppMode;
    label: string;
    dialect: string;
    schema: SchemaSnapshot | null;
    canWrite: boolean;
    zenMode: boolean;
    suggestedQuestions: string[];
    messages: ChatMessage[];
    canvas: CanvasObject[];
  }) => void;
  setZenMode: (v: boolean) => void;
  addMessage: (m: ChatMessage) => void;
  appendToMessage: (id: string, delta: string) => void;
  setMessageSteps: (id: string, steps: { agent: AgentName; label: string }[]) => void;
  addStepToMessage: (id: string, step: { agent: AgentName; label: string }) => void;
  setFollowUps: (id: string, questions: string[]) => void;
  /** Attach a HITL artifact (pending_write, report_plan) to a streaming
   *  assistant message so it renders INLINE in the chat bubble instead of
   *  on the canvas pane. Other canvas object types still go through
   *  `addCanvasObject`. */
  addInlineArtifact: (messageId: string, obj: CanvasObject) => void;
  finalizeMessage: (id: string, opts?: { isError?: boolean }) => void;
  setSending: (v: boolean) => void;
  addCanvasObject: (obj: CanvasObject) => void;
  /** Remove the last assistant message (for regenerate). Returns the preceding user message content, or null. */
  popLastAssistant: () => string | null;
  addPendingWrite: (pw: PendingWriteState) => void;
  resolvePendingWrite: (pendingId: string, status: PendingWriteState["status"], rowsAffected?: number, error?: string) => void;
  setAuditCount: (n: number) => void;
  setDomain: (d: string | null) => void;
}

export const useSession = create<SessionStore>((set) => ({
  sessionId: null,
  mode: "sql",
  label: "",
  dialect: "sqlite",
  schema: null,
  canWrite: false,
  zenMode: false,
  connecting: false,
  connectError: null,
  suggestedQuestions: [],
  messages: [],
  sending: false,
  streamingId: null,
  canvas: [],
  pendingWrites: [],
  auditCount: 0,
  domain: null,

  setConnecting: (v) => set({ connecting: v }),
  setConnectError: (e) => set({ connectError: e }),
  connect: (data) =>
    set({
      sessionId: data.sessionId,
      mode: data.mode ?? "sql",
      label: data.label,
      dialect: data.dialect,
      schema: data.schema,
      canWrite: data.canWrite,
      zenMode: false,
      connecting: false,
      connectError: null,
      suggestedQuestions: data.suggestedQuestions,
      messages: [],
      canvas: [],
      pendingWrites: [],
      domain: null,
    }),
  reset: () =>
    set({
      sessionId: null,
      mode: "sql",
      label: "",
      schema: null,
      canWrite: false,
      zenMode: false,
      connecting: false,
      connectError: null,
      suggestedQuestions: [],
      messages: [],
      canvas: [],
      pendingWrites: [],
      domain: null,
    }),
  loadSession: (data) =>
    set({
      sessionId: data.sessionId,
      mode: data.mode ?? "sql",
      label: data.label,
      dialect: data.dialect,
      schema: data.schema,
      canWrite: data.canWrite,
      zenMode: data.zenMode,
      connecting: false,
      connectError: null,
      suggestedQuestions: data.suggestedQuestions,
      messages: data.messages,
      canvas: data.canvas,
      pendingWrites: [],
      domain: null,
    }),
  setZenMode: (v) => set({ zenMode: v }),
  addMessage: (m) =>
    set((s) => ({ messages: [...s.messages, m], streamingId: m.streaming ? m.id : s.streamingId })),
  appendToMessage: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)),
    })),
  setMessageSteps: (id, steps) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, steps } : m)) })),
  addStepToMessage: (id, step) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, steps: [...(m.steps || []), step] } : m
      ),
    })),
  setFollowUps: (id, questions) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, followUps: questions } : m)),
    })),
  addInlineArtifact: (messageId, obj) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, inlineArtifacts: [...(m.inlineArtifacts ?? []), obj] }
          : m
      ),
    })),
  finalizeMessage: (id, opts) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, streaming: false, isError: opts?.isError } : m
      ),
      streamingId: null,
    })),
  setSending: (v) => set({ sending: v }),
  addCanvasObject: (obj) => set((s) => ({ canvas: [...s.canvas, obj] })),
  popLastAssistant: () => {
    let userContent: string | null = null;
    set((s) => {
      // Find the last assistant message index.
      const lastAssistantIdx = [...s.messages].reverse().findIndex((m) => m.role === "assistant");
      if (lastAssistantIdx === -1) return s;
      const idx = s.messages.length - 1 - lastAssistantIdx;
      // Find the preceding user message.
      for (let i = idx - 1; i >= 0; i--) {
        if (s.messages[i].role === "user") {
          userContent = s.messages[i].content;
          break;
        }
      }
      return { messages: s.messages.slice(0, idx) };
    });
    return userContent;
  },
  addPendingWrite: (pw) => set((s) => ({ pendingWrites: [...s.pendingWrites, pw] })),
  // ZEN-MODE BUG FIX: previously the pending_write canvas card stayed "PENDING"
  // forever after the user clicked Confirm/Dry-run/Cancel. The store only
  // patched the separate pendingWrites[] array, not the canvas[] entry. Now
  // we patch BOTH the canvas[] entry AND any inlineArtifacts entry on a chat
  // message (HITL now lives in chat, not canvas — but the canvas[] still
  // holds the artifact for persistence, just not for display).
  resolvePendingWrite: (pendingId, status, rowsAffected, error) =>
    set((s) => ({
      pendingWrites: s.pendingWrites.map((p) =>
        p.pendingId === pendingId ? { ...p, status, rowsAffected, error } : p
      ),
      canvas: s.canvas.map((obj) =>
        obj.type === "pending_write" && obj.pendingId === pendingId
          ? { ...obj, status, rowsAffected, error }
          : obj
      ),
      messages: s.messages.map((m) => ({
        ...m,
        inlineArtifacts: m.inlineArtifacts?.map((obj) =>
          obj.type === "pending_write" && obj.pendingId === pendingId
            ? { ...obj, status, rowsAffected, error }
            : obj
        ),
      })),
    })),
  setAuditCount: (n) => set({ auditCount: n }),
  setDomain: (d) => set({ domain: d }),
}));
