import "server-only";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildKclProject,
  type CadDoc,
} from "@foundry/cad";

/**
 * Materialize a CadDoc multi-file project onto disk for Zoo MCP.
 * Entry is always `main.kcl` at the project root (Zoo MCP convention).
 * Part files are laid out as `parts/<name>/main.kcl` via buildKclProject.
 */
export async function withKclProjectDir<T>(
  doc: CadDoc,
  entryPath: string,
  fn: (projectDir: string) => Promise<T>,
): Promise<T> {
  const build = buildKclProject(doc, entryPath);
  const root = await mkdtemp(join(tmpdir(), "foundry-kcl-"));
  try {
    const entrySrc = build.files[build.entryPath] ?? "";
    await writeFile(join(root, "main.kcl"), entrySrc, "utf8");

    for (const [rel, src] of Object.entries(build.files)) {
      if (rel === build.entryPath) continue;
      if (!src?.trim()) continue;
      const abs = join(root, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, src, "utf8");
    }

    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
