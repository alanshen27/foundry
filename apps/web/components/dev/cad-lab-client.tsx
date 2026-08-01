"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CAD_LAB_MCP_COMMANDS, type CadLabRequest, type CadLabResponse } from "@/lib/cad-lab";

const DEFAULT_PROMPT = "A 40mm x 40mm x 10mm mounting bracket with four 4mm corner holes";

const DEFAULT_KCL = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [40, 0])
  |> line(end = [0, 40])
  |> line(end = [-40, 0])
  |> close()
extrude001 = extrude(profile001, length = 10)
`;

type McpPreset = {
  label: string;
  command: (typeof CAD_LAB_MCP_COMMANDS)[number];
  args: string;
  note: string;
};

const MCP_PRESETS: McpPreset[] = [
  {
    label: "Zoo MCP",
    command: "uvx",
    args: "zoo-mcp",
    note: "Official Zoo/KittyCAD MCP (execute_kcl, bounding box, multiview…). Needs ZOO_API_TOKEN.",
  },
  {
    label: "Custom stdio MCP",
    command: "npx",
    args: "-y <your-cad-mcp-package>",
    note: "Any stdio MCP server, e.g. one wrapping the earthtojake/text-to-cad build123d skills.",
  },
];

async function runCadLab(body: CadLabRequest): Promise<CadLabResponse> {
  const res = await fetch("/api/dev/cad-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as CadLabResponse;
}

function ResultView({ result }: { result: CadLabResponse | null }) {
  if (!result) return null;
  if (!result.ok) {
    return (
      <pre className="max-h-96 overflow-auto border border-destructive/40 bg-destructive/10 p-3 text-xs whitespace-pre-wrap text-destructive">
        {result.error}
      </pre>
    );
  }
  if (result.kind === "image") {
    return (
      <div className="space-y-2">
        <img src={result.dataUri} alt="CAD snapshot" className="max-w-full border border-border" />
        {result.text ? (
          <pre className="max-h-48 overflow-auto border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
            {result.text}
          </pre>
        ) : null}
      </div>
    );
  }
  const text =
    result.kind === "kcl"
      ? result.kcl
      : result.kind === "json"
        ? JSON.stringify(result.data, null, 2)
        : result.text;
  return (
    <div className="space-y-1">
      {result.kind === "kcl" ? (
        <p className="text-xs text-muted-foreground">Zoo op id: {result.id}</p>
      ) : null}
      <pre className="max-h-96 overflow-auto border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
        {text}
      </pre>
    </div>
  );
}

export function CadLabClient() {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [kcl, setKcl] = useState(DEFAULT_KCL);
  const [command, setCommand] = useState<(typeof CAD_LAB_MCP_COMMANDS)[number]>("uvx");
  const [args, setArgs] = useState("zoo-mcp");
  const [tool, setTool] = useState("text_to_cad");
  const [toolArgs, setToolArgs] = useState(`{\n  "prompt": "${DEFAULT_PROMPT}"\n}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<CadLabResponse | null>(null);

  const run = async (label: string, body: CadLabRequest) => {
    setBusy(label);
    setResult(null);
    try {
      setResult(await runCadLab(body));
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const server = () => ({
    command,
    args: args.split(/\s+/).filter(Boolean),
  });

  const callMcpTool = () => {
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(toolArgs) as Record<string, unknown>;
    } catch {
      setResult({ ok: false, error: "Tool args must be valid JSON" });
      return;
    }
    void run("mcp_call_tool", {
      action: "mcp_call_tool",
      server: server(),
      tool,
      toolArgs: parsedArgs,
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">CAD Lab</h1>
        <Badge variant="outline">DEV ONLY</Badge>
        {busy ? <Badge variant="secondary">Running {busy}…</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Test Zoo ML text-to-CAD, Zoo MCP KCL tools, and other CAD MCP servers with a prompt. Zoo
        actions require <code>ZOO_API_TOKEN</code> in the root <code>.env</code>. Output is raw
        engine/tool output — UNVERIFIED, not engineering evidence.
      </p>

      <Tabs defaultValue="zoo-ml">
        <TabsList>
          <TabsTrigger value="zoo-ml">Zoo ML</TabsTrigger>
          <TabsTrigger value="zoo-mcp">Zoo MCP (KCL)</TabsTrigger>
          <TabsTrigger value="custom-mcp">Custom MCP</TabsTrigger>
        </TabsList>

        <TabsContent value="zoo-ml" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Zoo ML text-to-CAD</CardTitle>
              <CardDescription>
                Generate KCL from a prompt, or iterate on the KCL below with a prompt.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cad-lab-prompt">Prompt</Label>
                <Textarea
                  id="cad-lab-prompt"
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cad-lab-kcl-ml">KCL (for iterate)</Label>
                <Textarea
                  id="cad-lab-kcl-ml"
                  rows={8}
                  className="font-mono text-xs"
                  value={kcl}
                  onChange={(e) => setKcl(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy !== null}
                  onClick={() => void run("text-to-CAD", { action: "zoo_text_to_cad", prompt })}
                >
                  Generate (text-to-CAD)
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void run("iterate", { action: "zoo_iterate", prompt, kcl })}
                >
                  Iterate KCL with prompt
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="zoo-mcp" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Zoo MCP KCL tools</CardTitle>
              <CardDescription>
                Run the KCL below through Zoo MCP (<code>uvx zoo-mcp</code>): execute, bounding box,
                or multiview snapshot.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cad-lab-kcl-mcp">KCL</Label>
                <Textarea
                  id="cad-lab-kcl-mcp"
                  rows={10}
                  className="font-mono text-xs"
                  value={kcl}
                  onChange={(e) => setKcl(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy !== null}
                  onClick={() => void run("execute", { action: "zoo_execute", kcl })}
                >
                  Execute
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void run("bounding box", { action: "zoo_bbox", kcl })}
                >
                  Bounding box
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void run("multiview", { action: "zoo_multiview", kcl })}
                >
                  Multiview snapshot
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custom-mcp" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Custom CAD MCP server</CardTitle>
              <CardDescription>
                Spawn any stdio MCP server, list its tools, and call one with JSON args. Note:
                earthtojake/text-to-cad ships agent <em>skills</em> (build123d/Python), not an MCP
                server — install with <code>npx skills install earthtojake/text-to-cad</code> or
                point this at an MCP wrapper for it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {MCP_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    variant="secondary"
                    size="sm"
                    title={preset.note}
                    onClick={() => {
                      setCommand(preset.command);
                      setArgs(preset.args);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="cad-lab-command">Command</Label>
                  <select
                    id="cad-lab-command"
                    className="h-8 w-full border border-input bg-background px-2 text-sm"
                    value={command}
                    onChange={(e) =>
                      setCommand(e.target.value as (typeof CAD_LAB_MCP_COMMANDS)[number])
                    }
                  >
                    {CAD_LAB_MCP_COMMANDS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cad-lab-args">Args (space separated)</Label>
                  <Input id="cad-lab-args" value={args} onChange={(e) => setArgs(e.target.value)} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="cad-lab-tool">Tool name</Label>
                  <Input id="cad-lab-tool" value={tool} onChange={(e) => setTool(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cad-lab-tool-args">Tool args (JSON)</Label>
                  <Textarea
                    id="cad-lab-tool-args"
                    rows={4}
                    className="font-mono text-xs"
                    value={toolArgs}
                    onChange={(e) => setToolArgs(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("list tools", { action: "mcp_list_tools", server: server() })
                  }
                >
                  List tools
                </Button>
                <Button disabled={busy !== null} onClick={callMcpTool}>
                  Call tool
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ResultView result={result} />
    </div>
  );
}
