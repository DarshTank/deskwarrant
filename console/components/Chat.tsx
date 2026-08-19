"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UiMessage } from "@/app/api/devices/[id]/conversations/route";
import { api } from "@/lib/client-api";

interface PendingConfirm {
  jobId: string;
  toolName: string;
  args: Record<string, unknown>;
  expiresAt?: string;
}

interface HistoryResponse {
  conversations: { id: string; title: string | null; createdAt: string }[];
  activeConversationId: string | null;
  messages: UiMessage[];
  pendingConfirms: PendingConfirm[];
}

interface RunningTool {
  jobId: string;
  toolName: string;
  summary: string;
  status: "running" | "DONE" | "FAILED" | "EXPIRED";
}

export function Chat({
  deviceId,
  online,
  compact = false,
}: {
  deviceId: string;
  online: boolean;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [runningTools, setRunningTools] = useState<RunningTool[]>([]);
  const [confirms, setConfirms] = useState<PendingConfirm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadHistory = useCallback(
    async (cid?: string | null) => {
      const qs = cid ? `?conversationId=${encodeURIComponent(cid)}` : "";
      const data = await api<HistoryResponse>(
        `/api/devices/${deviceId}/conversations${qs}`,
      );
      setMessages(data.messages);
      setConversationId(data.activeConversationId);
      setConfirms(data.pendingConfirms);
      setLoaded(true);
    },
    [deviceId],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadHistory().catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load history.");
        setLoaded(true);
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [loadHistory]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, runningTools, confirms, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Apply one SSE event. Only calls stable setters, so it needs no deps. */
  const handleEvent = useCallback((event: Record<string, unknown>) => {
    switch (event.type) {
      case "conversation":
        setConversationId(event.conversationId as string);
        break;
      case "status":
        setStatus(event.text as string);
        break;
      case "tool_start": {
        const calls = event.calls as {
          jobId: string;
          toolName: string;
          summary: string;
        }[];
        setStatus(null);
        setRunningTools((prev) => [
          ...prev,
          ...calls.map((c) => ({ ...c, status: "running" as const })),
        ]);
        break;
      }
      case "tool_result": {
        const jobId = event.jobId as string;
        const resultStatus = event.status as RunningTool["status"];
        setRunningTools((prev) =>
          prev.map((t) => (t.jobId === jobId ? { ...t, status: resultStatus } : t)),
        );
        break;
      }
      case "confirm_required":
        setConfirms((prev) => [
          ...prev.filter((c) => c.jobId !== event.jobId),
          {
            jobId: event.jobId as string,
            toolName: event.toolName as string,
            args: event.args as Record<string, unknown>,
          },
        ]);
        break;
      case "error":
        setError(event.message as string);
        break;
      default:
        break;
    }
  }, []);

  /**
   * Open the SSE turn. The endpoint is POST-only (it carries a body), so this
   * reads the stream manually rather than using EventSource.
   */
  const runTurn = useCallback(
    async (body: { message?: string; resumeJobId?: string }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStreaming(true);
      setError(null);
      setRunningTools([]);
      setStatus("Thinking");

      try {
        const res = await fetch(`/api/devices/${deviceId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Omit conversationId rather than sending null. The route accepts
          // `conversationId?: string`, and Zod's .optional() rejects null —
          // so a first message, when no conversation exists yet, would 400.
          body: JSON.stringify({
            ...body,
            ...(conversationId ? { conversationId } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "");
          let message = `The assistant could not be reached (${res.status}).`;
          try {
            const parsed = JSON.parse(detail) as { error?: string };
            if (parsed.error) message = parsed.error;
          } catch {
            /* keep the generic message */
          }
          throw new Error(message);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            } catch {
              continue;
            }
            handleEvent(event);
          }
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setError(err instanceof Error ? err.message : "The turn failed.");
        }
      } finally {
        setStreaming(false);
        setStatus(null);
        setRunningTools([]);
        await loadHistory(conversationId).catch(() => {});
      }
    },
    [deviceId, conversationId, loadHistory, handleEvent],
  );

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    // Optimistic echo so the message appears instantly.
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "USER",
        content: text,
        toolCalls: null,
        toolResults: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    await runTurn({ message: text });
  }

  async function decide(jobId: string, approve: boolean) {
    setConfirms((prev) => prev.filter((c) => c.jobId !== jobId));
    try {
      await api(`/api/jobs/${jobId}/${approve ? "confirm" : "cancel"}`, {
        method: "POST",
      });
      // Either way the turn resumes: the model is told it ran, or that the
      // user declined, so it can acknowledge rather than silently stopping.
      await runTurn({ resumeJobId: jobId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That decision failed.");
    }
  }

  async function newConversation() {
    try {
      const data = await api<{ conversationId: string }>(
        `/api/devices/${deviceId}/conversations`,
        { method: "POST" },
      );
      setConversationId(data.conversationId);
      await loadHistory(data.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a chat.");
    }
  }

  const visible = messages.filter(
    (m) => m.role !== "TOOL" && (m.content.trim() !== "" || m.toolCalls),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b-2 border-border px-4 py-2.5">
        <span className="text-[12px] uppercase tracking-[0.06em] text-muted">
          {online ? "Ask about this PC" : "PC is offline — answers unavailable"}
        </span>
        <button
          type="button"
          onClick={() => void newConversation()}
          className="text-[12px] uppercase tracking-[0.06em] text-muted transition-colors hover:text-accent"
        >
          New chat
        </button>
      </div>

      <div
        ref={scrollRef}
        className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {!loaded && <p className="text-[15px] text-muted">Loading…</p>}

        {loaded && visible.length === 0 && (
          <EmptyChat compact={compact} onPick={(q) => setInput(q)} />
        )}

        {visible.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {runningTools.length > 0 && (
          <div className="border-2 border-border bg-surface px-3 py-2">
            {runningTools.map((tool) => (
              <div
                key={tool.jobId}
                className="flex items-center gap-2 py-0.5 text-xs"
              >
                <ToolStatusIcon status={tool.status} />
                <span className="font-mono text-muted">{tool.summary}</span>
              </div>
            ))}
          </div>
        )}

        {status && (
          <p className="text-xs text-muted">
            <span className="inline-block animate-pulse">{status}…</span>
          </p>
        )}

        {confirms.map((confirm) => (
          <ConfirmCard
            key={confirm.jobId}
            confirm={confirm}
            onDecide={(approve) => void decide(confirm.jobId, approve)}
          />
        ))}

        {error && (
          <p className="border-2 border-danger/50 bg-danger/10 px-3 py-2 text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t-2 border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={
              online ? "Is my download finished?" : "This PC is offline"
            }
            className="max-h-32 min-h-[42px] flex-1 resize-none border-2 border-border bg-surface px-3 py-2.5 text-[15px] outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={streaming || input.trim() === ""}
            className="border-2 border-accent bg-accent px-5 py-2.5 text-[14px] font-extrabold uppercase tracking-[0.06em] text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {streaming ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyChat({
  compact,
  onPick,
}: {
  compact: boolean;
  onPick: (q: string) => void;
}) {
  const suggestions = [
    "Is Chrome running?",
    "What's using the most CPU?",
    "How much disk space is left?",
    "Is my download finished?",
  ];
  return (
    <div className="py-6">
      <p className="text-[15px] leading-[1.6] text-muted">
        Ask anything about this PC. Answers come from live system data — never
        from a screenshot.
      </p>
      {!compact && (
        <div className="mt-4 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="border-2 border-border px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-accent hover:text-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: UiMessage }) {
  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-accent px-4 py-2.5 text-[15px] leading-[1.5] text-accent-fg">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.toolCalls && message.toolCalls.length > 0 && (
        <details className="border-l-2 border-hairline bg-surface px-3 py-2">
          <summary className="cursor-pointer text-[12px] uppercase tracking-[0.06em] text-muted">
            Ran {message.toolCalls.length}{" "}
            {message.toolCalls.length === 1 ? "tool" : "tools"}
          </summary>
          <ul className="mt-2 space-y-1">
            {message.toolCalls.map((call) => (
              <li key={call.id} className="font-mono text-[11px] text-muted">
                {call.name}({JSON.stringify(call.args)})
                {call.error && (
                  <span className="ml-1 text-danger">— {call.error}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {message.content.trim() !== "" && (
        <p className="max-w-[95%] text-[15px] leading-[1.62] whitespace-pre-wrap">
          {message.content}
        </p>
      )}
    </div>
  );
}

function ConfirmCard({
  confirm,
  onDecide,
}: {
  confirm: PendingConfirm;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <div className="border-2 border-warn/60 bg-warn/10 p-4">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-warn">
        Confirm this action
      </p>
      <p className="mt-2.5 font-mono text-[13px] text-foreground">
        {confirm.toolName}({JSON.stringify(confirm.args)})
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onDecide(true)}
          className="border-2 border-danger bg-danger px-4 py-2 text-[12px] font-extrabold uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-90"
        >
          Do it
        </button>
        <button
          type="button"
          onClick={() => onDecide(false)}
          className="border-2 border-border px-4 py-2 text-[12px] font-extrabold uppercase tracking-[0.08em] transition-colors hover:border-accent hover:text-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ToolStatusIcon({ status }: { status: RunningTool["status"] }) {
  if (status === "running") {
    return (
      <span className="h-2 w-2 shrink-0 animate-pulse bg-accent" />
    );
  }
  if (status === "DONE") {
    return <span className="h-2 w-2 shrink-0 bg-online" />;
  }
  return <span className="h-2 w-2 shrink-0 bg-danger" />;
}
