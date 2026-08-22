import type { Device, Job, Message } from "@prisma/client";
import type Groq from "groq-sdk";
import { prisma } from "../db";
import { assertJobQuota } from "../rate-limit";
import { groqClient, groqModel } from "./groq";
import { buildSystemPrompt } from "./prompt";
import { describeToolCall, toGroqTools, validateToolCall } from "./tools";

/** Build plan §9: hard ceiling on tool round trips per turn. */
const MAX_ITERATIONS = 4;

/**
 * True for Groq's 400 `tool_use_failed`, raised when the model emits a
 * malformed tool call rather than a structured one. It says nothing about
 * credentials or configuration — it is a bad roll of the dice, and retrying
 * the same request usually succeeds.
 */
function isToolUseFailure(err: unknown): boolean {
  const body = (err as { error?: { error?: { code?: string } } })?.error?.error;
  return body?.code === "tool_use_failed";
}

/**
 * Turn a model failure into something the user can act on.
 *
 * Blaming GROQ_API_KEY for every failure sends people to check a key that was
 * never the problem, so the credential message is reserved for actual auth
 * errors.
 */
function describeModelError(err: unknown): string {
  const status = (err as { status?: number })?.status;

  if (status === 401 || status === 403) {
    return "The assistant could not authenticate. Check that GROQ_API_KEY is set correctly.";
  }
  if (status === 404) {
    return "That model is not available on this account. Check GROQ_MODEL against console.groq.com/docs/models.";
  }
  if (status === 429) {
    return "The assistant is rate limited right now. Wait a moment and try again.";
  }
  // 413 is a size rejection, not a pace one: the request exceeded the account's
  // whole per-minute token allowance, so waiting changes nothing and "try
  // again" is actively misleading advice. Starting a new chat drops the history
  // that made it oversized, which is the one thing that does help.
  if (status === 413) {
    return "That conversation grew too large for the assistant's token limit. Start a new chat to continue.";
  }
  if (isToolUseFailure(err)) {
    return "The model kept returning a malformed tool call. Try asking again, or rephrase the question.";
  }
  return "The assistant is unavailable right now. See the server logs for details.";
}
/** How long a dispatched job may take before we give up on it. */
const JOB_TIMEOUT_MS = 20_000;
const JOB_POLL_INTERVAL_MS = 500;
/** Jobs expire if the agent never collects them. */
const JOB_TTL_MS = 60_000;
/**
 * Cap tool output fed back to the model, to bound token spend.
 *
 * Tapered by age. A directory listing serialises to ~11k characters, and the
 * model only ever reasons about the newest one -- older results are context it
 * has already used. Sending them all at full width is what pushed a routine
 * turn past the account's entire per-minute token budget, so stale results are
 * trimmed hard while the live one stays wide enough to answer from.
 */
const MAX_TOOL_RESULT_CHARS = 4_000;
const MAX_STALE_TOOL_RESULT_CHARS = 600;
const HISTORY_LIMIT = 20;

/**
 * Prompt budget, in tokens.
 *
 * Groq's on-demand tier meters tokens per minute and counts `max_tokens`
 * against the same allowance as the prompt, so a single oversized request is
 * rejected outright with 413 -- not throttled, not retried into success. It
 * fails identically whether the user is chatting fast or typing "Hello" into an
 * idle window, which is exactly what made it look like an outage.
 *
 * The system prompt and tool schemas are measured at call time rather than
 * guessed at, because both grow whenever a tool is added and a stale constant
 * here would silently reintroduce the same failure.
 */
const MODEL_TPM_BUDGET = 8_000;
const RESPONSE_TOKEN_BUDGET = 1_024; // Must track `max_tokens` below.
const BUDGET_SAFETY_MARGIN = 400; // Chat framing the estimator cannot see.
/** Floor, so a large tool catalogue can never starve history to nothing. */
const MIN_HISTORY_TOKEN_BUDGET = 512;

/** Cheap heuristic: ~4 characters per token. No tokeniser dependency. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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

  // Only the final tool exchange is rendered at full width; see
  // MAX_TOOL_RESULT_CHARS for why the rest are collapsed.
  let lastToolIndex = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].role === "TOOL") {
      lastToolIndex = i;
      break;
    }
  }

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

      const isLiveExchange = i + 1 === lastToolIndex;
      for (const call of calls) {
        const result = results.find((r) => r.id === call.id);
        out.push({
          role: "tool",
          tool_call_id: call.id,
          content: renderToolResult(result, isLiveExchange),
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

function renderToolResult(
  result: PersistedToolResult | undefined,
  isLiveExchange = true,
): string {
  const limit = isLiveExchange
    ? MAX_TOOL_RESULT_CHARS
    : MAX_STALE_TOOL_RESULT_CHARS;
  if (!result) return JSON.stringify({ error: "No result recorded." });
  if (result.status === "DONE") {
    return truncate(JSON.stringify(result.result ?? null), limit);
  }
  // Errors are short and are the whole point of the row, so never taper them.
  return truncate(
    JSON.stringify({ error: result.error ?? `Tool ${result.status}.` }),
    MAX_TOOL_RESULT_CHARS,
  );
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated]`;
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

  // Whatever the fixed prompt does not spend is what history may use. Both
  // halves are measured here rather than assumed, so adding a tool narrows the
  // history window automatically instead of silently overflowing the request.
  const fixedTokens =
    estimateTokens(system) + estimateTokens(JSON.stringify(tools));
  const historyTokenBudget = Math.max(
    MIN_HISTORY_TOKEN_BUDGET,
    MODEL_TPM_BUDGET - RESPONSE_TOKEN_BUDGET - BUDGET_SAFETY_MARGIN - fixedTokens,
  );
  if (
    MODEL_TPM_BUDGET - RESPONSE_TOKEN_BUDGET - BUDGET_SAFETY_MARGIN - fixedTokens <
    MIN_HISTORY_TOKEN_BUDGET
  ) {
    console.warn(
      `[assistant] system prompt and tool schemas alone are ~${fixedTokens} tokens, ` +
        `leaving less than ${MIN_HISTORY_TOKEN_BUDGET} for history against a ` +
        `${MODEL_TPM_BUDGET} budget. Trim the tool catalogue or raise the tier.`,
    );
  }

  /**
   * One model call, retrying a malformed tool call.
   *
   * Groq rejects a turn with 400 `tool_use_failed` when the model emits its
   * pseudo-syntax (`<function=name {...}></function>`) instead of a structured
   * tool call. It is stochastic — the same prompt usually succeeds on a second
   * attempt — so a retry costs one round trip and saves the whole turn. The
   * last attempt drops tools entirely: a plain text answer beats an error.
   */
  async function callModel({
    messages,
    withTools,
  }: {
    messages: Parameters<typeof groq.chat.completions.create>[0]["messages"];
    withTools: boolean;
  }) {
    const attempts = withTools ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const useTools = withTools && attempt < attempts - 1;
      try {
        return await groq.chat.completions.create({
          model: groqModel(),
          messages,
          ...(useTools ? { tools, tool_choice: "auto" as const } : {}),
          temperature: 0.2,
          max_tokens: 1024,
        });
      } catch (err) {
        lastError = err;
        if (!isToolUseFailure(err)) throw err;
        console.warn(
          `[assistant] malformed tool call from the model (attempt ${attempt + 1}/${attempts})`,
        );
      }
    }

    throw lastError;
  }

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (opts.signal?.aborted) return;

    const history = await loadHistory(conversationId, historyTokenBudget);
    const isFinalIteration = iteration === MAX_ITERATIONS - 1;

    emit({ type: "status", text: iteration === 0 ? "Thinking" : "Reading results" });

    let completion;
    try {
      completion = await callModel({
        messages: [{ role: "system", content: system }, ...history],
        // Build plan §9.5: on the final iteration force a text answer so the
        // turn cannot end with an unanswered tool call.
        withTools: !isFinalIteration,
      });
    } catch (err) {
      console.error("[assistant] groq call failed", err);
      emit({ type: "error", message: describeModelError(err) });
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

async function loadHistory(
  conversationId: string,
  tokenBudget: number,
): Promise<GroqMessage[]> {
  // Newest-first, then reversed, so `take` keeps the MOST RECENT window. Taking
  // ascending would cap at the OLDEST rows, and any conversation longer than
  // the cap would feed the model stale context forever while its actual
  // question scrolled off the end.
  //
  // `role` is the tiebreaker because an assistant/tool pair is written in one
  // transaction, and Postgres stamps every row in a transaction with the same
  // now() -- so the pair shares `createdAt` to the millisecond and `createdAt`
  // alone leaves their order undefined. When the TOOL row sorted first,
  // toGroqMessages found no results following the assistant row and dropped the
  // completed call entirely (see its `fullyAnswered` guard), throwing away a
  // tool result the turn had just waited seconds to get. MessageRole is
  // declared USER, ASSISTANT, TOOL and Postgres orders enums by declaration
  // order, so descending here puts TOOL before ASSISTANT before USER, and the
  // reverse below restores the order the protocol requires.
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { role: "desc" }],
    take: HISTORY_LIMIT * 2,
  });
  rows.reverse();

  // Keep the tail, but never split an assistant/tool pair at the boundary.
  const tail = rows.slice(-HISTORY_LIMIT);
  while (tail.length > 0 && tail[0].role === "TOOL") tail.shift();

  // Then drop from the front until the rendered history fits the budget. The
  // count cap alone is not enough: twenty short messages and three folder
  // listings differ by an order of magnitude, and it was the size that broke
  // the request, not the number. Measuring the RENDERED form matters -- rows
  // are stored untruncated, so the raw column is far larger than what is sent.
  while (tail.length > 1 && renderedTokens(tail) > tokenBudget) {
    tail.shift();
    while (tail.length > 0 && tail[0].role === "TOOL") tail.shift();
  }

  return toGroqMessages(tail);
}

/** Estimated tokens for what toGroqMessages will actually emit for `rows`. */
function renderedTokens(rows: Message[]): number {
  return toGroqMessages(rows).reduce((sum, m) => {
    const content = typeof m.content === "string" ? m.content : "";
    const calls = "tool_calls" in m ? JSON.stringify(m.tool_calls ?? "") : "";
    return sum + estimateTokens(content) + estimateTokens(calls);
  }, 0);
}

async function persistCallsAndResults(
  conversationId: string,
  assistantContent: string,
  calls: PersistedToolCall[],
  results: PersistedToolResult[],
) {
  // Stamp both rows explicitly, one millisecond apart. Left to the database
  // these two would tie: Postgres evaluates now() once per transaction, so
  // every row written here shares a `createdAt` and their relative order on
  // read is undefined. The tool protocol requires the assistant's tool_calls to
  // precede their results, so that ordering cannot be left to chance.
  // loadHistory sorts defensively as well; this keeps new rows correct for any
  // reader that sorts on time alone.
  const assistantAt = new Date();
  const toolAt = new Date(assistantAt.getTime() + 1);

  await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role: "ASSISTANT",
        content: assistantContent,
        toolCalls: calls as unknown as object,
        createdAt: assistantAt,
      },
    }),
    prisma.message.create({
      data: {
        conversationId,
        role: "TOOL",
        content: "",
        toolResults: results as unknown as object,
        createdAt: toolAt,
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
