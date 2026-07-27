import { NextResponse } from "next/server";
import { prisma } from "@foundry/db";
import { getCurrentUser } from "@/server/session";
import { requireProjectCapability } from "@/server/access";
import { createRunEventStream } from "@/server/chat-run/stream";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { runId } = await params;
  const run = await prisma.chatRun.findUnique({ where: { id: runId } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await requireProjectCapability(user.id, run.projectId, "project.read");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const stream = await createRunEventStream(runId);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
