/**
 * Emit extracted corpus records as JSON on stdout.
 *
 * Kept separate from the sink so a scrape can be inspected, diffed, or loaded
 * by something other than Supabase. Phase 1 sources only (repo constants and
 * an optional external sample directory) — neither touches user content.
 *
 *   pnpm --filter @foundry/kcl-corpus emit                 # repo constants
 *   pnpm --filter @foundry/kcl-corpus emit ../kcl-samples  # + external set
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { extractRepoConstants, extractSamples, type SampleFile } from "../src/index";

function readKclFiles(root: string): SampleFile[] {
  const out: SampleFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === ".git" || entry === "node_modules") continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith(".kcl")) {
        out.push({ path: relative(root, abs), content: readFileSync(abs, "utf8") });
      }
    }
  };
  walk(root);
  return out;
}

const sampleDir = process.argv[2];
const records = [
  ...extractRepoConstants({ license: "foundry-repo" }),
  ...(sampleDir
    ? extractSamples(readKclFiles(sampleDir), {
        license: "Apache-2.0",
        sourceRepo: "KittyCAD/kcl-samples",
      })
    : []),
];

process.stdout.write(JSON.stringify(records, null, 2));
process.stderr.write(`\n${records.length} records\n`);
