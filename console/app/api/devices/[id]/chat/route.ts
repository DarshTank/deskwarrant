import { z } from "zod";
import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { runAssistantTurn, type AssistantEvent } from "@/lib/assistant/loop";
import { prisma } from "@/lib/db";
import { badRequest, handleRoute, parseBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Vercel Hobby allows up to 60s. A turn is normally 4–6s (one tool round trip
 * at the 2s poll cadence); the ceiling only matters when the PC goes offline
 * mid-turn and jobs run to their 20s timeout.
 */
export const maxDuration = 60;

const bodySchema = z
  .object({
    message: z.string().min(1).max(4000).optional(),
    conversationId: z.string().max(64).optional(),
    /** Set instead of `message` to continue after a confirmation decision. */
    resumeJobId: z.string().max(64).optional(),
  })
  .refine((b) => Boolean(b.message) !== Boolean(b.resumeJobId), {
    message: "Provide exactly one of `message` or `resumeJobId`.",
  });

/**
 * POST /api/devices/:id/chat — streams the Assistant turn as SSE.
 *
 * Events are defined by AssistantEvent in lib/assistant/loop.ts.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);
    const body = await parseBody(req, bodySchema);

    // Resolve the conversation before opening the stream so a bad id is a
    // plain 400 rather than an error buried inside the event stream.
    let conversationId = body.conversationId;
    if (conversationId) {
      const existing = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      if (!existing || existing.deviceId !== device.id) {
        return badRequest("Unknown conversation for this device.");
      }
    } else {
      const latest = await prisma.conversation.findFirst({
        where: { deviceId: device.id },
        orderBy: { createdAt: "desc" },
      });
      conversationId =
        latest?.id ??
        (
          await prisma.conversation.create({
            data: {
              deviceId: device.id,
              title: body.message?.slice(0, 60) ?? "New conversation",
            },
          })
        ).id;
    }

    const encoder = new TextEncoder();
    const activeConversationId = conversationId;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (event: AssistantEvent) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          } catch {
            closed = true;
          }
        };

        // Tell the client which conversation this turn belongs to, so a first
        // message that implicitly created one can be followed up correctly.
        send({ type: "status", text: "Connected" });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "conversation", conversationId: activeConversationId })}\n\n`,
          ),
        );

        try {
          await runAssistantTurn({
            device,
            conversationId: activeConversationId,
            userMessage: body.message,
            resumeAfterJobId: body.resumeJobId,
            emit: send,
            signal: req.signal,
          });
        } catch (err) {
          console.error("[chat] turn failed", err);
          send({
            type: "error",
            message: "Something went wrong handling that message.",
          });
          send({ type: "done" });
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the client disconnecting
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });
}
