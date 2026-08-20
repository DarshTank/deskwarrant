import { z } from "zod";

/**
 * The Assistant's entire capability surface (build plan §8).
 *
 * Defined ONCE here and consumed by three places:
 *   1. The Groq request, as the tool list.
 *   2. Server-side argument validation, before a Job row is created.
 *   3. The Host Agent's dispatch registry, keyed by the same `toolName`.
 *
 * The model never emits shell commands, paths, or code — it selects a name from
 * this table and supplies typed arguments. Arguments are validated here and
 * validated AGAIN agent-side before execution (build plan §11).
 */

const hwnd = z
  .number()
  .int()
  .describe("Window handle, as returned by list_windows.");

const pid = z
  .number()
  .int()
  .positive()
  .describe("Process id, as returned by list_processes.");

// ---------- Read tools (§8.1) — never require confirmation ----------

export const listProcessesArgs = z.object({
  filter: z
    .string()
    .max(64)
    .optional()
    .describe(
      "Case-insensitive substring matched against the process name, e.g. 'chrome'.",
    ),
  sortBy: z
    .enum(["cpu", "memory", "name"])
    .optional()
    .describe("Sort order for the returned list. Defaults to cpu."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum rows to return. Defaults to 20, hard cap 50."),
});

export const listWindowsArgs = z.object({});

export const readWindowTextArgs = z.object({ hwnd });

export const listFolderArgs = z.object({
  path: z
    .string()
    .min(1)
    .max(400)
    .describe(
      "Absolute folder path. Must be inside the user's allowlisted roots (Downloads, Documents, Desktop, Pictures, Videos). System directories are always denied.",
    ),
  pattern: z
    .string()
    .max(64)
    .optional()
    .describe("Optional glob to filter names, e.g. '*.mp4'."),
});

export const getSystemStatsArgs = z.object({});

export const getDownloadStatusArgs = z.object({
  folder: z
    .string()
    .max(400)
    .optional()
    .describe(
      "Folder to scan. Defaults to the user's Downloads folder. Must be allowlisted.",
    ),
});

export const findFilesArgs = z.object({
  query: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "Name to look for. Containing * or ? makes it a glob ('*.pdf'); anything else is a case-insensitive substring ('invoice').",
    ),
  root: z
    .string()
    .max(400)
    .optional()
    .describe(
      "Single allowlisted folder to search. Defaults to searching every allowlisted root.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Maximum matches to return. Defaults to 50, hard cap 200."),
});

export const getVolumeArgs = z.object({});

export const listAppsArgs = z.object({
  filter: z
    .string()
    .max(64)
    .optional()
    .describe("Case-insensitive substring matched against the app name."),
});

// ---------- Action tools (§8.2) ----------

export const focusWindowArgs = z.object({ hwnd });
export const minimizeWindowArgs = z.object({ hwnd });
export const maximizeWindowArgs = z.object({ hwnd });
export const restoreWindowArgs = z.object({ hwnd });

export const openPathArgs = z.object({
  path: z
    .string()
    .min(1)
    .max(400)
    .describe(
      "Absolute path to a file or folder to open with its default handler. Must be allowlisted.",
    ),
});

export const setVolumeArgs = z.object({
  level: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Master output volume percentage."),
});

export const launchAppArgs = z.object({
  appId: z
    .string()
    .regex(
      /^[0-9a-f]{12}$/,
      "appId must be a 12-character id returned by list_apps.",
    )
    .describe("Opaque app id, as returned by list_apps."),
});

export const setMuteArgs = z.object({
  muted: z.boolean().describe("True to mute, false to unmute."),
});

export const mediaKeyArgs = z.object({
  key: z
    .enum(["play_pause", "next", "previous", "stop"])
    .describe("Which media transport key to press."),
});

export const closeWindowArgs = z.object({ hwnd });
export const killProcessArgs = z.object({ pid });
export const lockWorkstationArgs = z.object({});

// ---------- Catalog ----------

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  /** Destructive or irreversible → user must approve before dispatch (§8.2). */
  requiresConfirmation: boolean;
  /** Read tools may be batched into a single dispatch; actions may not. */
  kind: "read" | "action";
  /** Rendered in the confirmation card, filled with the actual arguments. */
  confirmSummary?: (args: Record<string, unknown>) => string;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "list_processes",
    kind: "read",
    requiresConfirmation: false,
    description:
      "List running processes with CPU and memory usage. Use this to answer whether an application is running, what is consuming resources, or to find a pid.",
    schema: listProcessesArgs,
  },
  {
    name: "list_windows",
    kind: "read",
    requiresConfirmation: false,
    description:
      "List open top-level windows with their titles, owning process, and whether each is minimized or in the foreground. Use this to find a window before focusing or closing it.",
    schema: listWindowsArgs,
  },
  {
    name: "read_window_text",
    kind: "read",
    requiresConfirmation: false,
    description:
      "Read the accessible text of a window via UI Automation, flattened and truncated. Use this to read progress text, dialog messages, or status bars. Many apps draw custom UI with no accessible text and will return nothing.",
    schema: readWindowTextArgs,
  },
  {
    name: "list_folder",
    kind: "read",
    requiresConfirmation: false,
    description:
      "List the contents of a folder with sizes and modified times. Partial-download files (.crdownload, .part, .tmp, .download) are flagged.",
    schema: listFolderArgs,
  },
  {
    name: "find_files",
    kind: "read",
    requiresConfirmation: false,
    description:
      "Search the user's folders for a file or folder by name when its location is unknown. Results are newest-first. Prefer list_folder when the folder is already known, and note the search is bounded by time and depth, so `truncated` may be true.",
    schema: findFilesArgs,
  },
  {
    name: "get_system_stats",
    kind: "read",
    requiresConfirmation: false,
    description:
      "Get CPU load, RAM usage, per-volume disk free space, battery state, and uptime.",
    schema: getSystemStatsArgs,
  },
  {
    name: "get_download_status",
    kind: "read",
    requiresConfirmation: false,
    description:
      "Check whether downloads are in progress. Scans a folder for partial-download files and samples their size over two seconds to distinguish actively growing from stalled. Prefer this over list_folder when asked whether a download has finished.",
    schema: getDownloadStatusArgs,
  },
  {
    name: "get_volume",
    kind: "read",
    requiresConfirmation: false,
    description:
      "Get the current master output volume and mute state. Call this first when the user asks for a relative change such as 'turn it down a bit', so the new level is based on the real one.",
    schema: getVolumeArgs,
  },
  {
    name: "list_apps",
    kind: "read",
    requiresConfirmation: false,
    description:
      "List the applications installed on this PC, each with an opaque appId. Use this to find an app before launching it. Shells, terminals, and language interpreters are deliberately excluded and will not appear.",
    schema: listAppsArgs,
  },
  {
    name: "focus_window",
    kind: "action",
    requiresConfirmation: false,
    description:
      "Bring a window to the foreground and restore it if minimized.",
    schema: focusWindowArgs,
  },
  {
    name: "minimize_window",
    kind: "action",
    requiresConfirmation: false,
    description: "Minimize a window.",
    schema: minimizeWindowArgs,
  },
  {
    name: "maximize_window",
    kind: "action",
    requiresConfirmation: false,
    description: "Maximize a window to fill the screen.",
    schema: maximizeWindowArgs,
  },
  {
    name: "restore_window",
    kind: "action",
    requiresConfirmation: false,
    description:
      "Restore a window to its previous size and position, undoing either a minimize or a maximize.",
    schema: restoreWindowArgs,
  },
  {
    name: "open_path",
    kind: "action",
    requiresConfirmation: false,
    description:
      "Open a file or folder with its default application. The path must be inside the allowlisted roots.",
    schema: openPathArgs,
  },
  {
    name: "launch_app",
    kind: "action",
    requiresConfirmation: false,
    description:
      "Start an installed application. The appId must come from list_apps -- this tool cannot launch anything that list_apps did not return, and it cannot take a path.",
    schema: launchAppArgs,
  },
  {
    name: "set_volume",
    kind: "action",
    requiresConfirmation: false,
    description: "Set the master output volume to a percentage.",
    schema: setVolumeArgs,
  },
  {
    name: "set_mute",
    kind: "action",
    requiresConfirmation: false,
    description:
      "Mute or unmute the master output. Prefer this over setting the volume to 0 when the user asks to mute, because it preserves the level to unmute back to.",
    schema: setMuteArgs,
  },
  {
    name: "media_key",
    kind: "action",
    requiresConfirmation: false,
    description:
      "Press a media transport key. Windows routes it to whatever is playing audio, so use this for play, pause, skip, and previous rather than locating the player's window first. It works even when the player is minimized.",
    schema: mediaKeyArgs,
  },
  {
    name: "close_window",
    kind: "action",
    requiresConfirmation: true,
    description:
      "Request that a window close. The application may prompt to save unsaved work. Requires user confirmation.",
    schema: closeWindowArgs,
    confirmSummary: (a) => `Close window ${a.hwnd}`,
  },
  {
    name: "kill_process",
    kind: "action",
    requiresConfirmation: true,
    description:
      "Forcibly terminate a process by pid. Unsaved work in that process is lost. Requires user confirmation.",
    schema: killProcessArgs,
    confirmSummary: (a) => `Force-kill process ${a.pid}`,
  },
  {
    name: "lock_workstation",
    kind: "action",
    requiresConfirmation: true,
    description:
      "Lock the workstation. Note the agent cannot interact with the lock screen afterwards. Requires user confirmation.",
    schema: lockWorkstationArgs,
    confirmSummary: () => "Lock the workstation",
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return TOOLS_BY_NAME.get(name);
}

/**
 * Convert the catalog to the OpenAI-compatible tool array Groq expects.
 * `$schema` is stripped: the API rejects unknown top-level keys on some models.
 */
export function toGroqTools() {
  return TOOLS.map((tool) => {
    const jsonSchema = z.toJSONSchema(tool.schema, {
      target: "draft-7",
      io: "input",
    }) as Record<string, unknown>;
    delete jsonSchema.$schema;
    // Groq requires `properties` to exist even for zero-argument tools.
    if (!jsonSchema.properties) jsonSchema.properties = {};
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema,
      },
    };
  });
}

/**
 * Coarse server-side path screen. The AUTHORITATIVE allowlist check happens on
 * the agent, which alone knows the configured roots (§8.3). This catches the
 * obvious cases early so a doomed Job is never dispatched.
 */
const DENIED_PATH_PATTERNS = [
  /^[a-z]:\\windows(\\|$)/i,
  /^[a-z]:\\program files( \(x86\))?(\\|$)/i,
  /^[a-z]:\\programdata(\\|$)/i,
  /^[a-z]:\\\$recycle\.bin(\\|$)/i,
  /^\\\\/, // UNC paths
];

export function isObviouslyDeniedPath(input: string): boolean {
  const p = input.trim();
  if (p.includes("\0")) return true;
  return DENIED_PATH_PATTERNS.some((re) => re.test(p));
}

/**
 * Argument names that carry a filesystem path. Every tool that takes one must
 * name its parameter from this list, so the screen below cannot be sidestepped
 * by calling it something new -- which is exactly how find_files first slipped
 * past it with `root`.
 */
const PATH_ARG_KEYS = ["path", "folder", "root"] as const;

export interface ValidatedToolCall {
  toolName: string;
  args: Record<string, unknown>;
  requiresConfirmation: boolean;
  kind: "read" | "action";
}

export type ToolValidationResult =
  | { ok: true; call: ValidatedToolCall }
  | { ok: false; error: string };

/** Validate one model-emitted tool call before it becomes a Job. */
export function validateToolCall(
  name: string,
  rawArgs: unknown,
): ToolValidationResult {
  const tool = getTool(name);
  if (!tool) return { ok: false, error: `Unknown tool "${name}".` };

  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Invalid arguments for ${name}: ${detail}` };
  }

  const args = parsed.data as Record<string, unknown>;

  for (const key of PATH_ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && isObviouslyDeniedPath(value)) {
      return {
        ok: false,
        error: `Access to "${value}" is denied. Only the user's Downloads, Documents, Desktop, Pictures, and Videos folders are permitted.`,
      };
    }
  }

  return {
    ok: true,
    call: {
      toolName: tool.name,
      args,
      requiresConfirmation: tool.requiresConfirmation,
      kind: tool.kind,
    },
  };
}

/** Human-readable one-liner for the confirmation card and the tool log. */
export function describeToolCall(
  name: string,
  args: Record<string, unknown>,
): string {
  const tool = getTool(name);
  if (tool?.confirmSummary) return tool.confirmSummary(args);
  const argText = Object.entries(args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  return argText ? `${name}(${argText})` : `${name}()`;
}
