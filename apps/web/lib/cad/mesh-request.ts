import { z } from "zod";

/** Files are materialized beneath a private temporary project directory. */
export const cadMeshPathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) =>
      !/[\\\u0000-\u001f:?#%]/u.test(value) &&
      value
        .split("/")
        .every((part) => part.length > 0 && part !== "." && part !== ".." && !part.startsWith(".")),
    "Use a workspace-relative CAD path",
  );

const sourcePath = cadMeshPathSchema.refine(
  (value) => /\.(?:kcl|py)$/.test(value),
  "Expected CAD source file",
);

export const cadMeshRequestSchema = z
  .object({
    engine: z.enum(["build123d", "zoo"]).optional(),
    projectId: z.string().min(1).max(160).optional(),
    renderToken: z.string().min(1).max(4000).optional(),
    script: z.string().min(1).max(1_000_000),
    projectFiles: z.record(sourcePath, z.string().max(1_000_000)).optional(),
    entryPath: sourcePath.optional(),
    meshAssets: z
      .array(
        z.object({
          path: cadMeshPathSchema.refine(
            (value) => !/\.(?:kcl|py)$/.test(value),
            "Expected mesh asset",
          ),
          fileUrl: z.string().min(1).max(1000),
          format: z.string().min(1).max(32),
          lengthUnit: z.enum(["mm", "cm", "m", "in", "ft", "yd"]).optional(),
        }),
      )
      .max(64)
      .optional(),
  })
  .superRefine((input, ctx) => {
    const files = input.projectFiles ?? {};
    const extension = input.engine === "build123d" ? ".py" : ".kcl";
    if (
      [...Object.keys(files), ...(input.entryPath ? [input.entryPath] : [])].some(
        (path) => !path.endsWith(extension),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `This CAD engine requires ${extension} source files`,
      });
    }
    if (
      input.engine === "build123d" &&
      (!input.entryPath || !Object.hasOwn(files, input.entryPath))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Python preview requires its entry file in projectFiles",
      });
    }
    if (
      Object.keys(files).length > 128 ||
      Object.values(files).reduce((n, text) => n + text.length, input.script.length) > 2_000_000
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CAD project exceeds the preview limit",
      });
    }
    const assetPaths = input.meshAssets?.map((asset) => asset.path) ?? [];
    if (new Set(assetPaths).size !== assetPaths.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate mesh paths" });
    }
    // KCL supports direct imports and named imports using `from`. Reject paths
    // escaping the materialized project before invoking the local engine process.
    for (const source of input.engine === "build123d"
      ? []
      : [input.script, ...Object.values(files)]) {
      for (const match of source.matchAll(
        /\b(?:import|from)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))+["']([^"']+)["']/g,
      )) {
        const importPath = match[1]!.replace(/^(?:\.\/)+/, "");
        if (!cadMeshPathSchema.safeParse(importPath).success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Import path must stay inside the CAD project",
          });
        }
      }
    }
  });

export type CadMeshRequest = z.infer<typeof cadMeshRequestSchema>;

/** Only the already-authorized project's object namespace may be read. */
export function cadMeshStorageKey(fileUrl: string, projectId: string): string | null {
  const prefix = "/api/files/";
  if (!fileUrl.startsWith(prefix)) return null;
  const key = fileUrl.slice(prefix.length);
  if (!cadMeshPathSchema.safeParse(key).success || !key.startsWith(`projects/${projectId}/`))
    return null;
  return key;
}
