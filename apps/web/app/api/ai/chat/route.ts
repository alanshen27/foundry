import { NextResponse } from "next/server";
import { z } from "zod";
import { validateUIMessages } from "ai";
import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { getCurrentUser } from "@/server/session";
import { requireProjectCapability } from "@/server/access";
import { ensureDefaultChannel } from "@/server/chat";

const bodySchema = z.object({
  projectId: z.string(),
  branchId: z.string(),
  channelId: z.string().optional(),
  messages: z.array(z.unknown()),
});

/** Enqueue a copilot turn for the background worker; clients stream via SSE. */
export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "AI is not configured. Set OPENAI_API_KEY in the root .env to enable the copilot." },
      { status: 503 },
    );
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { projectId, branchId } = parsed.data;

  try {
    await requireProjectCapability(user.id, projectId, "agent.invoke");
  } catch {
    return NextResponse.json({ error: "Missing capability: agent.invoke" }, { status: 403 });
  }

  try {
    let channelId = parsed.data.channelId ?? null;
    if (channelId) {
      const channel = await prisma.chatChannel.findFirst({
        where: { id: channelId, projectId, branchId },
      });
      if (!channel) return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
    } else {
      channelId = (await ensureDefaultChannel(projectId, branchId)).id;
    }

    const messages = await validateUIMessages({ messages: parsed.data.messages });

    // One in-flight run per channel — client must Stop before sending again.
    const { expireStaleChatRuns } = await import("@/server/chat-run/stale");
    await expireStaleChatRuns(channelId);

    const active = await prisma.chatRun.findFirst({
      where: {
        channelId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      select: { id: true },
    });
    if (active) {
      return NextResponse.json(
        { error: "A reply is already in progress. Stop it before sending another message." },
        { status: 409 },
      );
    }

    // Store the turn before the model runs. If the run is cancelled, errors, or
    // the worker dies, the user's message is still in the history.
    const { saveNewMessages } = await import("@/server/chat-run/persist");
    await saveNewMessages({ projectId, branchId, channelId }, messages);

    const run = await prisma.chatRun.create({
      data: {
        projectId,
        branchId,
        channelId,
        actorId: user.id,
        inputMessages: messages as object,
      },
      select: { id: true },
    });

    try {
      const { enqueueChatRun } = await import("@/server/chat-run/queue");
      await enqueueChatRun(run.id);
    } catch (err) {
      console.error("enqueueChatRun failed:", err);
      await prisma.chatRun.update({
        where: { id: run.id },
        data: {
          status: "ERROR",
          error: "Failed to enqueue chat run (is Redis up?)",
          finishedAt: new Date(),
        },
      });
      return NextResponse.json(
        { error: "Chat queue unavailable. Check REDIS_URL and that Redis is reachable." },
        { status: 503 },
      );
    }

    return NextResponse.json({ runId: run.id, channelId }, { status: 202 });
  } catch (err) {
    console.error("POST /api/ai/chat failed:", err);
    return NextResponse.json(
      {
        error:
          "Copilot unavailable. Run `pnpm db:generate && pnpm db:push` and restart the dev server.",
      },
      { status: 500 },
    );
  }
}
