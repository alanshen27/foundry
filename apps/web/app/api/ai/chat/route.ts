import { NextResponse } from "next/server";
import { z } from "zod";
import { validateUIMessages } from "ai";
import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { getCurrentUser } from "@/server/session";
import { requireProjectCapability } from "@/server/access";
import { ensureDefaultChannel } from "@/server/chat";
import { createExclusiveAiRun } from "@/server/ai-edit-lock";

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

    // One in-flight AI editor per project branch, across every chat channel
    // and app instance. This same run is the workspace lock human saves read.
    const exclusive = await createExclusiveAiRun({
      projectId,
      branchId,
      channelId,
      actorId: user.id,
      inputMessages: messages as object,
    });
    if (!exclusive.created) {
      return NextResponse.json(
        {
          error:
            "This workspace is locked while another AI agent is editing it. Stop or finish that run before starting another.",
          activeRunId: exclusive.active.id,
        },
        { status: 409 },
      );
    }
    const run = exclusive.run;

    // Store the turn before the model runs. If the run is cancelled, errors, or
    // the worker dies, the user's message is still in the history.
    const { saveNewMessages } = await import("@/server/chat-run/persist");
    try {
      await saveNewMessages({ projectId, branchId, channelId }, messages);
    } catch (error) {
      // The run already owns the branch lock. Release it immediately instead
      // of making everyone wait for stale-run cleanup when persistence fails.
      await prisma.chatRun.update({
        where: { id: run.id },
        data: {
          status: "ERROR",
          error: "Failed to persist chat messages",
          finishedAt: new Date(),
        },
      });
      throw error;
    }

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
