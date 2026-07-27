/**
 * Throwaway probe: can we get a rendered PNG out of the Zoo engine from Node,
 * with no browser and no WebRTC? Builds a box with raw modeling commands (no
 * KCL), frames it, and asks for a snapshot.
 */
import { readFileSync, writeFileSync } from "node:fs";

const envFile = readFileSync(new URL(".env", import.meta.url), "utf8");
const token = envFile
  .split("\n")
  .find((line) => line.startsWith("ZOO_API_TOKEN="))
  ?.slice("ZOO_API_TOKEN=".length)
  .trim();
if (!token) {
  console.error("no ZOO_API_TOKEN");
  process.exit(1);
}

const url = new URL("wss://api.zoo.dev/ws/modeling/commands");
url.searchParams.set("video_res_width", "1024");
url.searchParams.set("video_res_height", "768");
url.searchParams.set("fps", "30");
url.searchParams.set("webrtc", "false");
url.searchParams.set("show_grid", "true");
url.searchParams.set("post_effect", "ssao");
url.searchParams.set("unlocked_framerate", "false");

const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";

const send = (cmd, id) =>
  ws.send(JSON.stringify({ type: "modeling_cmd_req", cmd_id: id, cmd }));

const uuid = () => crypto.randomUUID();
const SNAP_ID = uuid();
const PATH_ID = uuid();

const timer = setTimeout(() => {
  console.error("TIMEOUT — no snapshot after 60s");
  process.exit(1);
}, 60_000);

ws.onopen = () => {
  console.log("open; authenticating");
  ws.send(JSON.stringify({ type: "headers", headers: { Authorization: `Bearer ${token}` } }));
};

let built = false;

ws.onmessage = (ev) => {
  let msg;
  if (typeof ev.data === "string") {
    msg = JSON.parse(ev.data);
  } else {
    try {
      msg = JSON.parse(new TextDecoder().decode(new Uint8Array(ev.data)));
    } catch {
      console.log("binary frame", ev.data.byteLength, "bytes");
      return;
    }
  }

  if (msg.type === "ice_server_info" || msg.type === "trickle_ice") return;

  if (msg.success === false) {
    console.error("ERROR", JSON.stringify(msg.errors ?? msg).slice(0, 400));
    return;
  }

  const kind = msg.resp?.type ?? msg.type;
  console.log("<-", kind, msg.request_id ? `(${msg.request_id.slice(0, 8)})` : "");

  if (kind === "modeling_session_data" && !built) {
    built = true;
    console.log("building a box with raw modeling commands");
    send({ type: "start_path" }, PATH_ID);
    const pen = (x, y) => ({
      type: "extend_path",
      path: PATH_ID,
      segment: { type: "line", end: { x, y, z: 0 }, relative: false },
    });
    send({ type: "move_path_pen", path: PATH_ID, to: { x: -20, y: -20, z: 0 } }, uuid());
    send(pen(20, -20), uuid());
    send(pen(20, 20), uuid());
    send(pen(-20, 20), uuid());
    send({ type: "close_path", path_id: PATH_ID }, uuid());
    send({ type: "extrude", target: PATH_ID, distance: 25, faces: null }, uuid());
    send({ type: "view_isometric", padding: 0.2 }, uuid());
    send({ type: "zoom_to_fit", padding: 0.2 }, uuid());
    setTimeout(() => {
      console.log("requesting snapshot");
      send({ type: "take_snapshot", format: "png" }, SNAP_ID);
    }, 2500);
  }

  const data = msg.resp?.data?.modeling_response ?? msg.resp?.data;
  if (data?.type === "take_snapshot" || msg.request_id === SNAP_ID) {
    const contents = data?.data?.contents ?? data?.contents;
    if (contents) {
      const buf = Buffer.from(contents, "base64");
      writeFileSync("zoo-snapshot-probe.png", buf);
      console.log(`SNAPSHOT OK — ${buf.length} bytes -> zoo-snapshot-probe.png`);
      console.log("png magic:", buf.subarray(1, 4).toString("ascii"));
      clearTimeout(timer);
      ws.close();
      process.exit(0);
    }
    console.log("snapshot response without contents:", JSON.stringify(msg).slice(0, 300));
  }
};

ws.onerror = (e) => console.error("ws error", e.message ?? e);
ws.onclose = (e) => console.log("closed", e.code, e.reason);
