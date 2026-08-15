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
    console.error("[route error]", err);
    return serverError();
  }
}
