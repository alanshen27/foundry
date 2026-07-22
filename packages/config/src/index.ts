import { z } from "zod";

const serverEnvSchema = z
  .object({
    DATABASE_URL: z.string(),
    AUTH_MODE: z.enum(["supabase", "local"]).default("local"),
    AUTH_SECRET: z.string().min(8).optional(),
    STORAGE_MODE: z.enum(["supabase", "local"]).default("local"),
    STORAGE_BUCKET: z.string().default("artifacts"),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    NEXT_PUBLIC_REALTIME_MODE: z.enum(["supabase", "off"]).default("off"),
    // AI copilot (optional; chat is disabled with a clear notice when unset)
    OPENAI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default("gpt-4o-mini"),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === "local" && !env.AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET is required when AUTH_MODE=local",
      });
    }
    const needsSupabase =
      env.AUTH_MODE === "supabase" ||
      env.STORAGE_MODE === "supabase" ||
      env.NEXT_PUBLIC_REALTIME_MODE === "supabase";
    if (needsSupabase) {
      for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when a Supabase-backed mode is enabled`,
          });
        }
      }
    }
    if (
      (env.AUTH_MODE === "supabase" || env.STORAGE_MODE === "supabase") &&
      !env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SUPABASE_SERVICE_ROLE_KEY"],
        message: "SUPABASE_SERVICE_ROLE_KEY is required for supabase auth/storage",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetServerEnvCacheForTests(): void {
  cached = undefined;
}
