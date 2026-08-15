import type { Device, Job, Message } from "@prisma/client";
import type Groq from "groq-sdk";
import { prisma } from "../db";
import { assertJobQuota } from "../rate-limit";
import { groqClient, groqModel } from "./groq";
import { buildSystemPrompt } from "./prompt";
import { describeToolCall, toGroqTools, validateToolCall } from "./tools";

/** Build plan §9: hard ceiling on tool round trips per turn. */
const MAX_ITERATIONS = 4;
/** How long a dispatched job may take before we give up on it. */
const JOB_TIMEOUT_MS = 20_000;
const JOB_POLL_INTERVAL_MS = 500;
/** Jobs expire if the agent never collects them. */
const JOB_TTL_MS = 60_000;
/** Cap tool output fed back to the model, to bound token spend. */
const MAX_TOOL_RESULT_CHARS = 6_000;
const HISTORY_LIMIT = 20;

// ---------- SSE event contract (consumed by components/Chat.tsx) ----------

export type AssistantEvent =
  | { type: "status"; text: string }
  | {
      type: "tool_start";
      calls: { jobId: string; toolName: string; summary: string }[];
    }
  | {
      type: "tool_result";
      jobId: string;
      toolName: string;
      status: "DONE" | "FAILED" | "EXPIRED";
      error?: string;
    }
  | {
      type: "confirm_required";
      jobId: string;
      toolName: string;
      args: Record<string, unknown>;
      summary: string;
    }
  | { type: "message"; content: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type Emit = (event: AssistantEvent) => void;

/** Shape persisted on Message.toolCalls for an ASSISTANT message. */
interface PersistedToolCall {
  id: string; // the model's tool_call_id
  name: string;
  args: Record<string, unknown>;
  jobId?: string; // absent when validation rejected the call
  error?: string; // set when validation rejected the call
  requiresConfirmation?: boolean;
}

/** Shape persisted on Message.toolResults for a TOOL message. */
interface PersistedToolResult {
  id: string; // matches PersistedToolCall.id
  name: string;
  status: "DONE" | "FAILED" | "EXPIRED" | "CANCELLED" | "REJECTED";
  result?: unknown;
  error?: string;
}

type GroqMessage = Groq.Chat.Completions.ChatCompletionMessageParam;

// ---------- History reconstruction ----------

/**
 * Rebuild the Groq message array from persisted rows.
 *
 * The tool-calling protocol requires that every assistant `tool_calls` entry is
 * followed by exactly one `tool` message per call id. Rows are written to keep
 * that invariant, but a turn interrupted mid-flight (a crashed request, a
 * confirmation the user abandoned) can leave an assistant message whose calls
 * were never answered. Such a message is dropped rather than sent, because the
 * API rejects the whole request otherwise and the user would see every
 * subsequent turn fail.
 */
function toGroqMessages(rows: Message[]): GroqMessage[] {
  const out: GroqMessage[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (row.role === "USER") {
      out.push({ role: "user", content: row.content });
      continue;
    }

    if (row.role === "ASSISTANT") {
      const calls = (row.toolCalls as unknown as PersistedToolCall[]) ?? null;
      if (!calls || calls.length === 0) {
        if (row.content.trim()) out.push({ role: "assistant", content: row.content });
        continue;
      }

      const next = rows[i + 1];
      const results =
        next && next.role === "TOOL"
          ? ((next.toolResults as unknown as PersistedToolResult[]) ?? [])
          : [];
      const answered = new Set(results.map((r) => r.id));
      const fullyAnswered = calls.every((c) => answered.has(c.id));
      if (!fullyAnswered) continue; // drop the orphaned pair

      out.push({
        role: "assistant",
        content: row.content || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      });

      for (const call of calls) {
        const result = results.find((r) => r.id === call.id);
        out.push({
          role: "tool",
          tool_call_id: call.id,
          content: renderToolResult(result),
        });
      }
      i++; // the TOOL row was consumed above
      continue;
    }

    // A TOOL row not immediately preceded by its assistant message is skipped;
    // the ASSISTANT branch above emits them in lockstep.
  }

  return out;
}

function renderToolResult(result: PersistedToolResult | undefined): string {
  if (!result) return JSON.stringify({ error: "No result recorded." });
  if (result.status === "DONE") {
    return truncate(JSON.stringify(result.result ?? null));
  }
  return truncate(
    JSON.stringify({ error: result.error ?? `Tool ${result.status}.` }),
  );
}

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]`;
}

// ---------- Job dispatch and collection ----------

async function waitForJobs(
  jobIds: string[],
  emit: Emit,
): Promise<Map<string, Job>> {
  const collected = new Map<string, Job>();
  if (jobIds.length === 0) return collected;

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  const terminal = new Set(["DONE", "FAILED", "EXPIRED", "CANCELLED"]);

  while (Date.now() < deadline) {
    const jobs = await prisma.job.findMany({ where: { id: { in: jobIds } } });
    for (const job of jobs) {
      if (terminal.has(job.status) && !collected.has(job.id)) {
        collected.set(job.id, job);
        emit({
          type: "tool_result",
          jobId: job.id,
          toolName: job.toolName,
          status:
            job.status === "DONE"
              ? "DONE"
              : job.status === "EXPIRED"
                ? "EXPIRED"
                : "FAILED",
          error: job.error ?? undefined,
        });
      }
    }
    if (collected.size === jobIds.length) return collected;
    await sleep(JOB_POLL_INTERVAL_MS);
  }

  // Build plan §9d: anything unfinished at the deadline becomes an error result
  // fed back to the model, rather than failing the user's whole turn.
  const stragglers = jobIds.filter((id) => !collected.has(id));
  if (stragglers.length > 0) {
    await prisma.job.updateMany({
      where: { id: { in: stragglers }, status: { in: ["PENDING", "DISPATCHED", "AWAITING_CONFIRM"] } },
      data: { status: "EXPIRED", completedAt: new Date() },
    });
    const expired = await prisma.job.findMany({
      where: { id: { in: stragglers } },
    });
    for (const job of expired) {
      collected.set(job.id, job);
      emit({
        type: "tool_result",
        jobId: job.id,
        toolName: job.toolName,
        status: "EXPIRED",
        error: "The PC did not respond in time.",
      });
    }
  }

  return collected;
}

function jobToResult(
  call: PersistedToolCall,
  job: Job | undefined,
): PersistedToolResult {
  if (!job) {
    return {
      id: call.id,
      name: call.name,
      status: "EXPIRED",
      error: "No result recorded for this tool call.",
    };
  }
  switch (job.status) {
    case "DONE":
      return { id: call.id, name: call.name, status: "DONE", result: job.result };
    case "CANCELLED":
      return {
        id: call.id,
        name: call.name,
        status: "CANCELLED",
        error: "The user declined this action. Do not retry it.",
      };
    case "EXPIRED":
      return {
        id: call.id,
        name: call.name,
        status: "EXPIRED",
        error:
          "The PC did not respond in time. It may have gone offline. Do not retry automatically.",
      };
    default:
      return {
        id: call.id,
        name: call.name,
        status: "FAILED",
        error: job.error ?? "The tool failed on the PC.",
      };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- The turn ----------

export interface RunTurnOptions {
  device: Device;
  conversationId: string;
  /** A new user message, or omitted when resuming after a confirmation. */
  userMessage?: string;
  /** Set when resuming: the confirmed (or rejected) job that unblocks the turn. */
  resumeAfterJobId?: string;
  emit: Emit;
  signal?: AbortSignal;
}

export async function runAssistantTurn(opts: RunTurnOptions): Promise<void> {
  const { device, conversationId, emit } = opts;

  if (opts.userMessage) {
    await prisma.message.create({
      data: {
        conversationId,
        role: "USER",
        content: opts.userMessage,
      },
    });
  }

  // Resuming: the previous turn ended on a confirmation. Collect results for
  // every call in that assistant message, then fall through into the loop.
  if (opts.resumeAfterJobId) {
    const resolved = await resolvePendingToolCalls(conversationId, emit);
    if (!resolved) {
      emit({
        type: "error",
        message: "There is no pending action to resume.",
      });
      emit({ type: "done" });
      return;
    }
  }

  const groq = groqClient();
  const tools = toGroqTools();
  const system = buildSystemPrompt({
    deviceName: device.name,
    hostname: device.hostname,
    osVersion: device.osVersion,
  });

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (opts.signal?.aborted) return;

    const history = await loadHistory(conversationId);
    const isFinalIteration = iteration === MAX_ITERATIONS - 1;

    emit({ type: "status", text: iteration === 0 ? "Thinking" : "Reading results" });

    let completion;
    try {
      completion = await groq.chat.completions.create({
        model: groqModel(),
        messages: [{ role: "system", content: system }, ...history],
        // Build plan §9.5: on the final iteration force a text answer so the
        // turn cannot end with an unanswered tool call.
        ...(isFinalIteration ? {} : { tools, tool_choice: "auto" as const }),
        temperature: 0.2,
        max_tokens: 1024,
      });
    } catch (err) {
      console.error("[assistant] groq call failed", err);
      emit({
        type: "error",
        message:
          "The assistant is unavailable right now. Check that GROQ_API_KEY is set correctly.",
      });
      emit({ type: "done" });
      return;
    }

    const choice = completion.choices[0]?.message;
    if (!choice) {
      emit({ type: "error", message: "The assistant returned an empty response." });
      emit({ type: "done" });
      return;
    }

    const rawCalls = choice.tool_calls ?? [];

    if (rawCalls.length === 0) {
      const content = (choice.content ?? "").trim() || "I don't have an answer for that.";
      await prisma.message.create({
        data: { conversationId, role: "ASSISTANT", content },
      });
      emit({ type: "message", content });
      emit({ type: "done" });
      return;
    }

    // ----- Validate every call before anything is dispatched -----
    const persisted: PersistedToolCall[] = [];
    const dispatchable: { call: PersistedToolCall; requiresConfirmation: boolean }[] = [];

    for (const raw of rawCalls) {
      if (raw.type !== "function") continue;
      let parsedArgs: unknown = {};
      try {
        parsedArgs = raw.function.arguments ? JSON.parse(raw.function.arguments) : {};
      } catch {
        persisted.push({
          id: raw.id,
          name: raw.function.name,
          args: {},
          error: "Arguments were not valid JSON.",
        });
        continue;
      }

      const validation = validateToolCall(raw.function.name, parsedArgs);
      if (!validation.ok) {
        persisted.push({
          id: raw.id,
          name: raw.function.name,
          args: (parsedArgs as Record<string, unknown>) ?? {},
          error: validation.error,
        });
        continue;
      }

      const entry: PersistedToolCall = {
        id: raw.id,
        name: validation.call.toolName,
        args: validation.call.args,
        requiresConfirmation: validation.call.requiresConfirmation,
      };
      persisted.push(entry);
      dispatchable.push({
        call: entry,
        requiresConfirmation: validation.call.requiresConfirmation,
      });
    }

    // Every call was rejected by validation — feed the errors straight back.
    if (dispatchable.length === 0) {
      await persistCallsAndResults(
        conversationId,
        choice.content ?? "",
        persisted,
        persisted.map((c) => ({
          id: c.id,
          name: c.name,
          status: "FAILED" as const,
          error: c.error ?? "Invalid tool call.",
        })),
      );
      continue;
    }

    try {
      await assertJobQuota(device.id, dispatchable.length);
    } catch {
      emit({
        type: "error",
        message: "This device has hit its job rate limit. Try again in a minute.",
      });
      emit({ type: "done" });
      return;
    }

    // ----- Create jobs in ONE transaction so the agent collects the whole
    // batch in a single poll (build plan §9c — this is the latency budget). ---
    const now = Date.now();
    const created = await prisma.$transaction(
      dispatchable.map(({ call, requiresConfirmation }) =>
        prisma.job.create({
          data: {
            deviceId: device.id,
            toolName: call.name,
            args: call.args as object,
            status: requiresConfirmation ? "AWAITING_CONFIRM" : "PENDING",
            requiresConfirmation,
            expiresAt: new Date(now + JOB_TTL_MS),
          },
        }),
      ),
    );

    created.forEach((job, index) => {
      dispatchable[index].call.jobId = job.id;
    });

    const confirmJobs = created.filter((j) => j.requiresConfirmation);
    const autoJobs = created.filter((j) => !j.requiresConfirmation);

    if (autoJobs.length > 0) {
      emit({
        type: "tool_start",
        calls: autoJobs.map((job) => ({
          jobId: job.id,
          toolName: job.toolName,
          summary: describeToolCall(
            job.toolName,
            job.args as Record<string, unknown>,
          ),
        })),
      });
    }

    // ----- Confirmation gate: persist the calls, surface the card, END TURN.
    // The turn resumes via POST /api/devices/:id/chat { resumeJobId }. -------
    if (confirmJobs.length > 0) {
      await prisma.message.create({
        data: {
          conversationId,
          role: "ASSISTANT",
          content: choice.content ?? "",
          toolCalls: persisted as unknown as object,
        },
      });
      for (const job of confirmJobs) {
        emit({
          type: "confirm_required",
          jobId: job.id,
          toolName: job.toolName,
          args: job.args as Record<string, unknown>,
          summary: describeToolCall(
            job.toolName,
            job.args as Record<string, unknown>,
          ),
        });
      }
      emit({ type: "done" });
      return;
    }

    // ----- No confirmation needed: wait for the batch and feed results back --
    const jobs = await waitForJobs(
      autoJobs.map((j) => j.id),
      emit,
    );

    const results: PersistedToolResult[] = persisted.map((call) => {
      if (call.error) {
        return { id: call.id, name: call.name, status: "FAILED", error: call.error };
      }
      return jobToResult(call, call.jobId ? jobs.get(call.jobId) : undefined);
    });

    await persistCallsAndResults(
      conversationId,
      choice.content ?? "",
      persisted,
      results,
    );
  }

  // Ran out of iterations without the model producing a text answer.
  const fallback =
    "I gathered the data but couldn't settle on an answer. Try asking more specifically.";
  await prisma.message.create({
    data: { conversationId, role: "ASSISTANT", content: fallback },
  });
  emit({ type: "message", content: fallback });
  emit({ type: "done" });
}

async function loadHistory(conversationId: string): Promise<GroqMessage[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT * 2,
  });
  // Keep the tail, but never split an assistant/tool pair at the boundary.
  const tail = rows.slice(-HISTORY_LIMIT);
  while (tail.length > 0 && tail[0].role === "TOOL") tail.shift();
  return toGroqMessages(tail);
}

async function persistCallsAndResults(
  conversationId: string,
  assistantContent: string,
  calls: PersistedToolCall[],
  results: PersistedToolResult[],
) {
  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role: "ASSISTANT",
        content: assistantContent,
        toolCalls: calls as unknown as object,
      },
    }),
    prisma.message.create({
      data: {
        conversationId,
        role: "TOOL",
        content: "",
        toolResults: results as unknown as object,
      },
    }),
  ]);
}

/**
 * Resume path: the last assistant message holds tool calls that were never
 * answered because one of them needed confirmation. Wait for every job it
 * references (the confirmed one is now PENDING; a rejected one is CANCELLED),
 * then write the TOOL row that closes the protocol gap.
 */
async function resolvePendingToolCalls(
  conversationId: string,
  emit: Emit,
): Promise<boolean> {
  const last = await prisma.message.findFirst({
    where: { conversationId, role: "ASSISTANT" },
    orderBy: { createdAt: "desc" },
  });
  if (!last) return false;

  const calls = (last.toolCalls as unknown as PersistedToolCall[]) ?? [];
  if (calls.length === 0) return false;

  const already = await prisma.message.findFirst({
    where: { conversationId, role: "TOOL", createdAt: { gt: last.createdAt } },
  });
  if (already) return false; // already resolved

  const jobIds = calls.map((c) => c.jobId).filter((id): id is string => Boolean(id));
  const jobs = await waitForJobs(jobIds, emit);

  const results: PersistedToolResult[] = calls.map((call) => {
    if (call.error) {
      return { id: call.id, name: call.name, status: "FAILED", error: call.error };
    }
    return jobToResult(call, call.jobId ? jobs.get(call.jobId) : undefined);
  });

  await prisma.message.create({
    data: {
      conversationId,
      role: "TOOL",
      content: "",
      toolResults: results as unknown as object,
    },
  });

  return true;
}
