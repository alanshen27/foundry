import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@foundry/db";
import { getCurrentUser } from "@/server/session";
import { requireProjectCapability } from "@/server/access";
import { createRunEventStream } from "@/server/chat-run/stream";
import { expireStaleChatRuns } from "@/server/chat-run/stale";

const querySchema = z.object({
  projectId: z.string(),
  channelId: z.string(),
});

/** Reconnect to an in-flight copilot run for a channel (204 if none active). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    projectId: url.searchParams.get("projectId"),
    channelId: url.searchParams.get("channelId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const { projectId, channelId } = parsed.data;
  try {
    await requireProjectCapability(user.id, projectId, "project.read");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await expireStaleChatRuns(channelId);

    const run = await prisma.chatRun.findFirst({
      where: {
        projectId,
        channelId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!run) return new Response(null, { status: 204 });

    const stream = await createRunEventStream(run.id);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Run-Id": run.id,
      },
    });
  } catch (err) {
    console.error("GET /api/ai/chat/stream failed:", err);
    return NextResponse.json(
      {
        error:
          "Copilot stream unavailable. Run `pnpm db:generate && pnpm db:push` and restart the dev server.",
      },
      { status: 500 },
    );
  }
}
