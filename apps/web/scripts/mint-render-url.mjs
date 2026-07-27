// Temporary: mint a short-lived render token so the tight thumbnail framing can
// be eyeballed in a browser. Prints only the URL.
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const secret = createHash("sha256")
  .update(`foundry-render:${env.AUTH_SECRET ?? env.DATABASE_URL}`)
  .digest();

const [projectId, branchId, tight] = process.argv.slice(2);
const payload = Buffer.from(
  JSON.stringify({ projectId, branchId, kind: "model3d", exp: Date.now() + 5 * 60 * 1000 }),
).toString("base64url");
const token = `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;

console.log(
  `http://localhost:3000/render/model3d?token=${encodeURIComponent(token)}&view=iso${tight === "1" ? "&tight=1" : ""}`,
);
