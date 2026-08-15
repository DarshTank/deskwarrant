import { z } from "zod";

/**
 * The fixed watch-rule catalog (build plan §7, §3).
 *
 * Users enable and parameterise these; they cannot author new templates. That
 * constraint is what keeps rule evaluation a small, auditable amount of code on
 * the agent instead of a scripting surface.
 */

export const diskLowParams = z.object({
  volume: z
    .string()
    .regex(/^[A-Za-z]:$/, "Use a drive letter followed by a colon, e.g. C:")
    .describe("Drive to watch."),
  thresholdPercent: z
    .number()
    .int()
    .min(1)
    .max(99)
    .describe("Alert when free space falls below this percentage."),
});

export const processExitedParams = z.object({
  processName: z
    .string()
    .min(1)
    .max(64)
    .describe("Executable name, e.g. Premiere.exe. Case-insensitive."),
});

export const processStartedParams = processExitedParams;

export const cpuSustainedHighParams = z.object({
  thresholdPercent: z.number().int().min(10).max(100),
  durationSeconds: z
    .number()
    .int()
    .min(30)
    .max(3600)
    .describe("CPU must stay above the threshold for this long."),
});

export const downloadCompleteParams = z.object({
  folder: z
    .string()
    .max(400)
    .optional()
    .describe("Folder to watch. Defaults to the user's Downloads folder."),
});

export const batteryLowParams = z.object({
  thresholdPercent: z.number().int().min(1).max(99),
});

export const WATCH_TEMPLATES = {
  DISK_LOW: {
    label: "Disk space low",
    description: "Alert when a drive's free space drops below a threshold.",
    schema: diskLowParams,
    defaults: { volume: "C:", thresholdPercent: 10 },
  },
  PROCESS_EXITED: {
    label: "Program closed",
    description: "Alert when a named program stops running.",
    schema: processExitedParams,
    defaults: { processName: "notepad.exe" },
  },
  PROCESS_STARTED: {
    label: "Program started",
    description: "Alert when a named program starts running.",
    schema: processStartedParams,
    defaults: { processName: "notepad.exe" },
  },
  CPU_SUSTAINED_HIGH: {
    label: "CPU pegged",
    description: "Alert when CPU stays above a threshold for a sustained period.",
    schema: cpuSustainedHighParams,
    defaults: { thresholdPercent: 90, durationSeconds: 300 },
  },
  DOWNLOAD_COMPLETE: {
    label: "Download finished",
    description: "Alert when in-progress downloads in a folder finish.",
    schema: downloadCompleteParams,
    defaults: {},
  },
  BATTERY_LOW: {
    label: "Battery low",
    description: "Alert when the battery drops below a threshold while unplugged.",
    schema: batteryLowParams,
    defaults: { thresholdPercent: 20 },
  },
} as const;

export type WatchTemplateName = keyof typeof WATCH_TEMPLATES;

export const WATCH_TEMPLATE_NAMES = Object.keys(
  WATCH_TEMPLATES,
) as WatchTemplateName[];

export function isWatchTemplate(value: string): value is WatchTemplateName {
  return value in WATCH_TEMPLATES;
}

export type WatchParamValidation =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; error: string };

export function validateWatchParams(
  template: WatchTemplateName,
  raw: unknown,
): WatchParamValidation {
  const parsed = WATCH_TEMPLATES[template].schema.safeParse(raw ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, params: parsed.data as Record<string, unknown> };
}

/** Serialisable catalog for the rule-builder UI. */
export function watchCatalog() {
  return WATCH_TEMPLATE_NAMES.map((name) => ({
    template: name,
    label: WATCH_TEMPLATES[name].label,
    description: WATCH_TEMPLATES[name].description,
    defaults: WATCH_TEMPLATES[name].defaults as Record<string, unknown>,
  }));
}
