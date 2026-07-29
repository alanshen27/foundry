import WebSocket from "ws";
import { zookeeperPrompt } from "../src/zookeeper";

const token = process.env.ZOO_API_TOKEN;
if (!token) {
  console.error("missing ZOO_API_TOKEN");
  process.exit(1);
}

async function probe(url: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    const t = setTimeout(() => {
      console.log(url, "TIMEOUT");
      ws.terminate();
      resolve();
    }, 12_000);
    ws.on("open", () => {
      console.log(url, "OPEN");
      ws.send(
        JSON.stringify({
          type: "user",
          content: "Add a comment // hi at the top. Do not change geometry.",
          current_files: { "main.kcl": "width = 10\n" },
          forced_tools: ["edit_kcl_code"],
        }),
      );
    });
    ws.on("message", (d) => {
      const s = d.toString();
      console.log(url, "MSG", s.slice(0, 400));
      if (s.includes("end_of_stream") || s.includes('"error"')) {
        clearTimeout(t);
        ws.close();
        resolve();
      }
    });
    ws.on("unexpected-response", (_req, res) => {
      console.log(url, "HTTP", res.statusCode);
      clearTimeout(t);
      resolve();
    });
    ws.on("error", (e) => {
      console.log(url, "ERR", e.message);
      clearTimeout(t);
      resolve();
    });
    ws.on("close", (c, r) => {
      console.log(url, "CLOSE", c, r.toString());
      clearTimeout(t);
      resolve();
    });
  });
}

async function main() {
  for (const url of ["wss://api.zoo.dev/ws/ml/zookeeper", "wss://api.zoo.dev/ws/ml/copilot"]) {
    await probe(url);
  }

  console.log("--- zookeeperPrompt helper against /ws/ml/copilot ---");
  const r = await zookeeperPrompt({
    token,
    baseWsUrl: "wss://api.zoo.dev/ws/ml/copilot",
    prompt: "Add a single-line KCL comment at the top that says hello-foundry. Do not change geometry.",
    currentFiles: {
      "main.kcl":
        "width = 10\ns = startSketchOn(XY)\np = startProfile(s, at = [0,0])\n  |> line(end = [width,0])\n  |> line(end = [0,10])\n  |> line(end = [-width,0])\n  |> close()\nextrude(p, length = 3)\n",
    },
    forcedTools: ["edit_kcl_code"],
    timeoutMs: 180_000,
  });
  console.log(JSON.stringify(r, null, 2).slice(0, 2000));
  if (!r.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
