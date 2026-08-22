import { requireOwnedDevice, requireUser } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { handleRoute, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface UiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  jobId?: string;
  error?: string;
  requiresConfirmation?: boolean;
}

export interface UiToolResult {
  id: string;
  name: string;
  status: string;
  result?: unknown;
  error?: string;
}

export interface UiMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "TOOL";
  content: string;
  toolCalls: UiToolCall[] | null;
  toolResults: UiToolResult[] | null;
  createdAt: string;
}

/**
 * GET /api/devices/:id/conversations[?conversationId=...]
 *
 * Returns the conversation list plus the full message history of the active
 * one, so the chat panel hydrates in a single request.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);

    const requested = new URL(req.url).searchParams.get("conversationId");

    const conversations = await prisma.conversation.findMany({
      where: { deviceId: device.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, title: true, createdAt: true },
    });

    const activeId =
      requested && conversations.some((c) => c.id === requested)
        ? requested
        : (conversations[0]?.id ?? null);

    const messages = activeId
      ? await prisma.message.findMany({
          where: { conversationId: activeId },
          // `role` breaks the tie because an assistant/tool pair is written in
          // one transaction and shares a `createdAt` to the millisecond, which
          // leaves their order undefined on time alone -- a reloaded page could
          // render tool results above the call that produced them. MessageRole
          // is declared USER, ASSISTANT, TOOL and Postgres orders enums by
          // declaration order, so ascending is already the order we want.
          orderBy: [{ createdAt: "asc" }, { role: "asc" }],
          take: 200,
        })
      : [];

    const uiMessages: UiMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: (m.toolCalls as unknown as UiToolCall[]) ?? null,
      toolResults: (m.toolResults as unknown as UiToolResult[]) ?? null,
      createdAt: m.createdAt.toISOString(),
    }));

    // Any confirmation card still awaiting a decision, so a reloaded page shows
    // it again rather than stranding the turn.
    const pendingConfirms = await prisma.job.findMany({
      where: { deviceId: device.id, status: "AWAITING_CONFIRM", expiresAt: { gte: new Date() } },
      select: { id: true, toolName: true, args: true, expiresAt: true },
    });

    return json({
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
      })),
      activeConversationId: activeId,
      messages: uiMessages,
      pendingConfirms: pendingConfirms.map((j) => ({
        jobId: j.id,
        toolName: j.toolName,
        args: j.args as Record<string, unknown>,
        expiresAt: j.expiresAt.toISOString(),
      })),
    });
  });
}

/** POST /api/devices/:id/conversations — start a fresh conversation. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const user = await requireUser();
    const { id } = await params;
    const device = await requireOwnedDevice(id, user.id);

    const conversation = await prisma.conversation.create({
      data: { deviceId: device.id, title: "New conversation" },
    });

    return json({ conversationId: conversation.id });
  });
}
