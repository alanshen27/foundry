import { NextResponse } from "next/server";
import { z } from "zod";
import { validateUIMessages } from "ai";
import { prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { getCurrentUser } from "@/server/session";
import { requireProjectCapability } from "@/server/access";
import { ensureDefaultChannel } from "@/server/chat";
import { createExclusiveAiRun } from "@/server/ai-edit-lock";
import {
  buildAiPingTip,
  lastUserMessageId,
  lastUserText,
  shouldInvokeAi,
  shouldSuggestAiPing,
  uiMessageText,
} from "@/server/chat-run/should-respond";
import { stampLatestUserAuthor } from "@/lib/copilot/chat-message-meta";

const bodySchema = z.object({
  projectId: z.string(),
  branchId: z.string(),
  channelId: z.string().optional(),
  messages: z.array(z.unknown()),
});

/** Enqueue a copilot turn for the background worker; clients stream via SSE. */
export async function POST(request: Request) {
  const env = getServerEnv();
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

    const validated = await validateUIMessages({ messages: parsed.data.messages });
    // Attribute only the newest user turn to the session user — never rewrite
    // teammate messages that arrived without author metadata in the payload.
    const messages = stampLatestUserAuthor(validated, {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });
    const userText = lastUserText(messages);
    const invokeAi = shouldInvokeAi(userText);

    // Persist FIRST — before lock / enqueue / triage. A 409 lock or worker
    // failure must not erase the user's turn on reload.
    const { saveNewMessages } = await import("@/server/chat-run/persist");
    await saveNewMessages({ projectId, branchId, channelId }, messages);

    // No @AI → never start a run. Optionally drop a casual "ping @AI" tip.
    if (!invokeAi) {
      let tip: { id: string; text: string } | undefined;
      if (await shouldSuggestAiPing(userText)) {
        const userId = lastUserMessageId(messages) ?? `anon-${Date.now()}`;
        const tipMessage = buildAiPingTip(userId);
        await saveNewMessages({ projectId, branchId, channelId }, [tipMessage]);
        tip = {
          id: tipMessage.id,
          text: uiMessageText(tipMessage),
        };
      }
      return NextResponse.json({ runId: null, channelId, invoked: false, tip }, { status: 202 });
    }

    if (!env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: "AI is not configured. Set OPENAI_API_KEY in the root .env to enable the copilot.",
        },
        { status: 503 },
      );
    }

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
      // Messages already saved — client can retry the run without losing text.
      return NextResponse.json(
        {
          error:
            "This workspace is locked while another AI agent is editing it. Stop or finish that run before starting another.",
          activeRunId: exclusive.active.id,
          persisted: true,
        },
        { status: 409 },
      );
    }
    const run = exclusive.run;

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
        {
          error: "Chat queue unavailable. Check REDIS_URL and that Redis is reachable.",
          persisted: true,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ runId: run.id, channelId, invoked: true }, { status: 202 });
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
