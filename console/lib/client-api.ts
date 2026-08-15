"use client";

/** Thin fetch wrapper: unwraps `{ error }` bodies into thrown Errors. */
export async function api<T>(
  input: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json: body, ...rest } = init ?? {};
  const res = await fetch(input, {
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const message =
      (parsed as { error?: string })?.error ??
      `Request failed (${res.status}).`;
    throw new Error(message);
  }

  return parsed as T;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const delta = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(delta / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
