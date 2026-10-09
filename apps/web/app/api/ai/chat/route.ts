import { NextResponse } from "next/server";
import { z } from "zod";
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
import { validateResumableUIMessages } from "@/lib/copilot/messages";
import {
  describeWindow,
  policies,
  rateLimit,
  rateLimitAll,
  tooManyRequests,
} from "@/server/rate-limit";
import { checkWorkspaceBudget } from "@/server/ai-usage";
import { createLogger } from "@foundry/observability";

const log = createLogger("api:chat");

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

  let workspaceId: string;
  try {
    ({
      project: { workspaceId },
    } = await requireProjectCapability(user.id, projectId, "agent.invoke"));
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

    // Repairing before validation is what lets a channel recover on its own:
    // a run killed mid-tool leaves a call with no result in the stored
    // transcript, and that message alone used to reject every later send.
    const validated = await validateResumableUIMessages(parsed.data.messages);
    if (validated.length === 0) {
      return NextResponse.json({ error: "No usable messages in this request" }, { status: 400 });
    }
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
      // The triage is a model call on every plain message, so it is limited
      // too — but over the limit it is simply skipped, since a missing nudge
      // costs the user nothing.
      const triage = await rateLimit(policies().aiTriage, user.id);
      if (triage.allowed && (await shouldSuggestAiPing(messages))) {
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

    // Limits come after the message is saved (the text survives a 429) and
    // before the run exists (a refused turn spends nothing).
    const limits = policies();
    const limited = await rateLimitAll([
      { policy: limits.aiRunBurst, identifier: user.id },
      { policy: limits.aiRunHourly, identifier: user.id },
    ]);
    if (!limited.allowed) {
      const seconds = Math.max(1, Math.ceil(limited.retryAfterMs / 1000));
      const window = limited.policy ? describeWindow(limited.policy.windowMs) : "period";
      return tooManyRequests(
        limited,
        `You're starting copilot runs faster than the limit allows (${limited.limit} per ${window}). Your message is saved; try again in ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`}.`,
        { persisted: true },
      );
    }
    const budget = await checkWorkspaceBudget(workspaceId);
    if (!budget.allowed) {
      return NextResponse.json(
        { error: budget.message, persisted: true, usage: budget.usage },
        { status: 429 },
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
      log.error("enqueue failed", { runId: run.id, projectId, err });
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
    log.error("chat request failed", { projectId, err });
    return NextResponse.json(
      {
        error:
          "Copilot unavailable. Run `pnpm db:generate && pnpm db:push` and restart the dev server.",
      },
      { status: 500 },
    );
  }
}
