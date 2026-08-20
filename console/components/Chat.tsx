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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-[clamp(12px,3vw,24px)] py-2.5">
        <span className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-faint">
          <span
            className={`size-1.5 shrink-0 rounded-full ${online ? "bg-signal dw-beat" : "bg-offline"}`}
            aria-hidden="true"
          />
          <span className="truncate">
            {online ? "ready" : "offline — answers unavailable"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void newConversation()}
          className="shrink-0 rounded-full px-3 py-1 text-[13px] text-soft transition-colors hover:bg-ink/[0.05] hover:text-ink"
        >
          New chat
        </button>
      </div>

      <div
        ref={scrollRef}
        className="thin-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-[clamp(12px,3vw,24px)] py-5"
      >
        {!loaded && <p className="text-[15px] text-faint">Loading…</p>}

        {loaded && visible.length === 0 && (
          <EmptyChat compact={compact} onPick={(q) => setInput(q)} />
        )}

        {visible.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {runningTools.length > 0 && (
          <div className="rounded-2xl border border-line bg-raised px-4 py-3">
            {runningTools.map((tool) => (
              <div
                key={tool.jobId}
                className="flex items-center gap-2.5 py-1 font-mono text-[12.5px]"
              >
                <ToolStatusIcon status={tool.status} />
                <span className="min-w-0 truncate text-soft">{tool.summary}</span>
              </div>
            ))}
          </div>
        )}

        {status && (
          <p className="flex items-center gap-2 font-mono text-[12.5px] text-faint">
            <span className="dw-beat size-1.5 rounded-full bg-signal" />
            {status}…
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
          <p className="rounded-2xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-[14px] text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-[clamp(10px,2.5vw,16px)]">
        <div className="flex items-end gap-2 rounded-3xl border border-line bg-raised py-1.5 pr-1.5 pl-4 transition-colors focus-within:border-signal">
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
            aria-label="Message"
            className="thin-scroll max-h-32 min-h-[38px] flex-1 resize-none bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={streaming || input.trim() === ""}
            aria-label="Send"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-paper transition-opacity hover:opacity-85 disabled:opacity-30"
          >
            {streaming ? (
              <span className="dw-beat size-2 rounded-full bg-paper" />
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>
        <p className="mt-2 px-2 text-[11.5px] text-faint">
          Answers come from live system data — never from a screenshot.
        </p>
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
      <h2 className="max-w-[22ch] font-serif text-[clamp(24px,3.4vw,32px)] leading-[1.08] tracking-[-0.02em]">
        Ask this machine anything.{" "}
        <span className="text-soft italic">In your own words.</span>
      </h2>
      {!compact && (
        <div className="mt-6 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-full border border-line px-3.5 py-1.5 text-[13.5px] text-soft transition-colors hover:border-signal hover:text-ink"
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
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-ink px-4 py-2.5 text-[15px] leading-[1.5] text-paper">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {message.toolCalls && message.toolCalls.length > 0 && (
        <details className="group rounded-2xl border border-line2 px-4 py-2.5">
          <summary className="cursor-pointer font-mono text-[12px] text-faint marker:content-[''] hover:text-soft">
            <span className="group-open:hidden">▸ </span>
            <span className="hidden group-open:inline">▾ </span>
            ran {message.toolCalls.length}{" "}
            {message.toolCalls.length === 1 ? "tool" : "tools"}
          </summary>
          <ul className="mt-2.5 space-y-1.5">
            {message.toolCalls.map((call) => (
              <li
                key={call.id}
                className="font-mono text-[11.5px] break-all text-soft"
              >
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
        <p className="max-w-[68ch] text-[15.5px] leading-[1.62] whitespace-pre-wrap">
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
    <div className="rounded-2xl border border-warn/35 bg-warn/[0.07] p-5">
      <p className="eyebrow text-warn">Needs your say-so</p>
      <p className="mt-3 font-mono text-[13px] break-all text-ink">
        {confirm.toolName}({JSON.stringify(confirm.args)})
      </p>
      <p className="mt-2 text-[14px] text-soft">
        This one has consequences, so nothing runs until you say.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onDecide(true)}
          className="rounded-full bg-ink px-5 py-2 text-[13px] font-medium text-paper transition-opacity hover:opacity-85"
        >
          Do it
        </button>
        <button
          type="button"
          onClick={() => onDecide(false)}
          className="rounded-full border border-line px-5 py-2 text-[13px] font-medium text-soft transition-colors hover:border-ink/35 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ToolStatusIcon({ status }: { status: RunningTool["status"] }) {
  if (status === "running") {
    return <span className="dw-beat size-1.5 shrink-0 rounded-full bg-signal" />;
  }
  if (status === "DONE") {
    return <span className="size-1.5 shrink-0 rounded-full bg-signal" />;
  }
  return <span className="size-1.5 shrink-0 rounded-full bg-danger" />;
}
