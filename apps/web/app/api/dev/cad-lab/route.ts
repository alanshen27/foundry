import { NextResponse } from "next/server";
import { getServerEnv } from "@foundry/config";
import { ZooMcpClient } from "@foundry/cad/server";
import { getCad } from "@/server/cad";
import { cadLabEnabled, cadLabRequestSchema, type CadLabResponse } from "@/lib/cad-lab";

/**
 * Dev-only CAD Lab runner. Exercises Zoo ML text-to-CAD / iteration, Zoo MCP
 * KCL tools, and arbitrary stdio CAD MCP servers from /dev/cad-lab.
 * Disabled in production unless CAD_LAB_ENABLED=1.
 */

// Zoo text-to-CAD can take several minutes.
export const maxDuration = 600;

function json(body: CadLabResponse, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  if (!cadLabEnabled(process.env)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = cadLabRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ ok: false, error: `Invalid request: ${parsed.error.message}` }, 400);
  }
  const body = parsed.data;

  try {
    switch (body.action) {
      case "zoo_text_to_cad": {
        const result = await getCad().textToCad(body.prompt);
        if (!result.ok) return json(result, 502);
        return json({ ok: true, kind: "kcl", kcl: result.data.kcl, id: result.data.id });
      }
      case "zoo_iterate": {
        const result = await getCad().iterateCad(body.kcl, body.prompt);
        if (!result.ok) return json(result, 502);
        return json({ ok: true, kind: "kcl", kcl: result.data.kcl, id: result.data.id });
      }
      case "zoo_execute": {
        const result = await getCad().executeKcl({ code: body.kcl });
        if (!result.ok) return json(result, 502);
        return json({ ok: true, kind: "text", text: result.data.message });
      }
      case "zoo_bbox": {
        const result = await getCad().boundingBoxKcl({ code: body.kcl, unit: body.unit });
        if (!result.ok) return json(result, 502);
        return json({ ok: true, kind: "json", data: result.data });
      }
      case "zoo_multiview": {
        const result = await getCad().multiviewSnapshotKcl({ code: body.kcl });
        if (!result.ok) return json(result, 502);
        return json({
          ok: true,
          kind: "image",
          dataUri: `data:image/jpeg;base64,${result.data.jpeg.toString("base64")}`,
        });
      }
      case "mcp_list_tools":
      case "mcp_call_tool": {
        const env = getServerEnv();
        const client = new ZooMcpClient({
          token: env.ZOO_API_TOKEN?.trim() ?? "",
          command: body.server.command,
          args: body.server.args,
          env: body.server.env,
        });
        try {
          if (body.action === "mcp_list_tools") {
            const result = await client.listTools();
            if (!result.ok) return json(result, 502);
            return json({ ok: true, kind: "json", data: result.data });
          }
          const result = await client.callGenericTool(body.tool, body.toolArgs);
          if (!result.ok) return json(result, 502);
          const image = result.data.images[0];
          if (image) {
            return json({
              ok: true,
              kind: "image",
              dataUri: `data:${image.mimeType};base64,${image.base64}`,
              text: result.data.text || undefined,
            });
          }
          if (result.data.structured !== undefined) {
            return json({ ok: true, kind: "json", data: result.data.structured });
          }
          return json({ ok: true, kind: "text", text: result.data.text });
        } finally {
          await client.close();
        }
      }
    }
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
