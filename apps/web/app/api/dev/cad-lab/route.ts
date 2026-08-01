import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

/** Zoo returns assemblies as several files; the engine needs them on disk together. */
async function writeProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cad-lab-"));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    if (!target.startsWith(dir + path.sep)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return dir;
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
      case "zoo_prompt_render": {
        const cad = getCad();
        const t0 = Date.now();
        const gen = await cad.textToCadProject(body.prompt);
        const generateMs = Date.now() - t0;
        if (!gen.ok) return json(gen, 502);
        const files = gen.data.files;

        const projectDir = await writeProject(files);
        try {
          const t1 = Date.now();
          const exec = await cad.executeKcl({ projectDir });
          const executeMs = Date.now() - t1;

          const t2 = Date.now();
          const env = getServerEnv();
          const snapClient = new ZooMcpClient({ token: env.ZOO_API_TOKEN?.trim() ?? "" });
          const images: string[] = [];
          try {
            const multiview = await snapClient.callGenericTool("multiview_snapshot_of_kcl", {
              kcl_path: projectDir,
              zoom: true,
            });
            const isometric = await snapClient.callGenericTool("multi_isometric_snapshot_of_kcl", {
              kcl_path: projectDir,
            });
            for (const snap of [multiview, isometric]) {
              if (!snap.ok) continue;
              for (const img of snap.data.images) {
                images.push(`data:${img.mimeType};base64,${img.base64}`);
              }
            }
          } finally {
            await snapClient.close();
          }
          const snapshotMs = Date.now() - t2;

          return json({
            ok: true,
            kind: "render",
            kcl: files["main.kcl"] ?? Object.values(files)[0] ?? "",
            files,
            id: gen.data.id,
            images,
            executeOk: exec.ok,
            executeMessage: exec.ok ? exec.data.message : exec.error,
            timings: { generateMs, executeMs, snapshotMs },
          });
        } finally {
          await rm(projectDir, { recursive: true, force: true });
        }
      }
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
