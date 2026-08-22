import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function tooManyRequests(message = "Rate limit exceeded") {
  return NextResponse.json({ error: message }, { status: 429 });
}

export function serverError(message = "Internal error") {
  return NextResponse.json({ error: message }, { status: 500 });
}

export function serviceUnavailable(message = "Service unavailable") {
  return NextResponse.json({ error: message }, { status: 503 });
}

/**
 * Prisma error codes that mean "the database was not reachable", as opposed to
 * "the query was wrong". P2024 is the connection-pool timeout and is the one
 * that actually shows up in production: it fires after `pool_timeout` (10s by
 * default) when every pooled connection is busy.
 *
 * These deserve a 503, not a 500. The agent backs off on any 5xx
 * (`transport.py`), so its behaviour is unchanged -- but a 503 in the logs says
 * "infrastructure" instead of sending the next reader hunting for a code bug.
 */
const DB_UNREACHABLE_CODES = new Set([
  "P2024", // Timed out fetching a new connection from the pool
  "P1001", // Can't reach database server
  "P1002", // Database server reached but timed out
  "P1008", // Operation timed out
  "P1017", // Server has closed the connection
]);

export function isDatabaseUnreachable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string" &&
    DB_UNREACHABLE_CODES.has((err as { code: string }).code)
  );
}

/**
 * Thrown by helpers to unwind to a Response. Route handlers catch it via
 * `handleRoute`, keeping the happy path free of early-return plumbing.
 */
export class HttpError extends Error {
  constructor(
    readonly response: NextResponse,
    message = "HttpError",
  ) {
    super(message);
  }
}

export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(badRequest("Body must be valid JSON"));
  }
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new HttpError(badRequest("Invalid request body", err.issues));
    }
    throw err;
  }
}

/**
 * Wraps a handler so thrown HttpErrors become responses.
 *
 * Typed against `Response`, not `NextResponse`, so streaming handlers (the chat
 * SSE route) can return a plain Response without a cast.
 */
export async function handleRoute(
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return err.response;
    if (isDatabaseUnreachable(err)) {
      console.error("[route error] database unreachable", err);
      return serviceUnavailable("Database unavailable");
    }
    console.error("[route error]", err);
    return serverError();
  }
}
