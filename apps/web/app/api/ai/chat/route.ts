import { NextResponse } from "next/server";
import { z } from "zod";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  validateUIMessages,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { prisma, type Prisma } from "@foundry/db";
import { getServerEnv } from "@foundry/config";
import { getCurrentUser } from "@/server/session";
import { requireProjectCapability } from "@/server/access";
import { buildProjectTools } from "@/server/ai/tools";

export const maxDuration = 120;

const bodySchema = z.object({
  projectId: z.string(),
  branchId: z.string(),
  messages: z.array(z.unknown()),
});

const SYSTEM_PROMPT = `You are the FOUNDRY copilot: an AI hardware engineer embedded in a product-development workspace with four stages — Ideate, Engineer, Verify, Launch.

You have tools that write directly into the project. Use them; don't just describe what could be done.

When the user describes a product idea (especially a first prompt), bootstrap the whole pipeline:
1. update_brief — capture intent, environment, audience, budget, dimensions, performance targets.
2. add_requirements — 6-12 concrete, testable requirements with sensible priorities and units.
3. add_components — a realistic starter BOM across ELECTRONICS / MECHANICAL / SOFTWARE / DESIGN with real part numbers where you know them and rough unit costs in cents.
4. save_circuit — a plausible schematic connecting the main electronic components.
5. save_model3d — a simple parametric mock-up of the physical product (millimetres).
6. add_validation_checks — checks derived from the requirements (every MUST gets one).
7. write_code_file — starter firmware (e.g. src/main.cpp) matching the circuit's MCU and sensors.

For follow-up edits, call get_project_state first if you're unsure what exists, change only what the user asked for, and keep other stages consistent. If your change invalidates previously approved downstream work, the system marks those stages STALE automatically — mention it when it happens. Use request_review when a human should re-check a stage you altered significantly.

Be concise in prose. Summarise what you changed and why in a few sentences after the tool calls. Never invent tool results.`;

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

  const tools = buildProjectTools({ userId: user.id, projectId, branchId });
  const messages = await validateUIMessages({ messages: parsed.data.messages });

  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  const result = streamText({
    model: openai(env.AI_MODEL),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(14),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ messages: finalMessages }) => {
      // Persist the whole thread (last-write-wins) so the sidebar restores
      // history on reload.
      await prisma.$transaction([
        prisma.chatMessage.deleteMany({ where: { projectId, branchId } }),
        prisma.chatMessage.createMany({
          data: (finalMessages as UIMessage[]).map((m) => ({
            projectId,
            branchId,
            role: m.role,
            parts: m.parts as unknown as Prisma.InputJsonValue,
          })),
        }),
      ]);
    },
  });
}
