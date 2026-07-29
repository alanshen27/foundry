import { z } from "zod";

const serverEnvSchema = z
  .object({
    DATABASE_URL: z.string(),
    AUTH_MODE: z.enum(["supabase", "local"]).default("local"),
    AUTH_SECRET: z.string().min(8).optional(),
    STORAGE_BUCKET: z.string().default("artifacts"),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    NEXT_PUBLIC_REALTIME_MODE: z.enum(["supabase", "off"]).default("off"),
    // Yjs / Hocuspocus collaboration (Engineer > Code). Empty = single-player Monaco.
    // Localhost on Render is treated as unset so a leftover ws://localhost:1234
    // does not crash getServerEnv() and take down chat/auth with it.
    NEXT_PUBLIC_COLLAB_URL: z.preprocess((value) => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      if (process.env.RENDER) {
        try {
          const host = new URL(trimmed).hostname;
          if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
            console.warn(
              `[config] Ignoring NEXT_PUBLIC_COLLAB_URL=${trimmed} on Render — set wss://<foundry-collab-host>`,
            );
            return undefined;
          }
        } catch {
          return undefined;
        }
      }
      return trimmed;
    }, z.string().url().optional()),
    // On Render, never silently fall back to localhost — that yields endless
    // AggregateError ECONNREFUSED spam and a SIGTERM'd web process.
    REDIS_URL: z.preprocess(
      (value) => {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      },
      process.env.RENDER
        ? z.string({ required_error: "REDIS_URL is required on Render (Upstash rediss://…)" }).url()
        : z.string().url().default("redis://localhost:6379"),
    ),
    // AI copilot (optional; chat is disabled with a clear notice when unset)
    OPENAI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default("gpt-5.6"),
    APP_ORIGIN: z.string().url().optional(),
    // Zoo / KittyCAD engine + text-to-CAD (required for mechanical MODEL3D)
    ZOO_API_TOKEN: z.preprocess((value) => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }, z.string().min(1).optional()),
    // v0 Platform API — generates, previews, and deploys storefront sites.
    // Unset falls back to a clearly-labeled SIMULATED builder (dev/e2e only).
    V0_API_KEY: z.preprocess((value) => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }, z.string().min(1).optional()),
    // Optional: land signed-in users on this workspace slug when they are a member.
    FOUNDRY_DEFAULT_WORKSPACE_SLUG: z.preprocess((value) => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }, z.string().min(1).max(64).optional()),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === "local" && !env.AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET is required when AUTH_MODE=local",
      });
    }

    // On Render, localhost URLs mean a copied .env / missing dashboard secret.
    if (process.env.RENDER) {
      const localHosts = ["localhost", "127.0.0.1", "::1"];
      const isLocal = (value: string | undefined) => {
        if (!value) return false;
        try {
          return localHosts.includes(new URL(value).hostname);
        } catch {
          return localHosts.some((h) => value.includes(h));
        }
      };

      if (isLocal(env.NEXT_PUBLIC_SUPABASE_URL)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["NEXT_PUBLIC_SUPABASE_URL"],
          message: "Must be your Supabase project URL on Render (not localhost)",
        });
      }
      if (isLocal(env.DATABASE_URL)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["DATABASE_URL"],
          message: "Must be Supabase Postgres on Render (not localhost)",
        });
      }
      if (isLocal(env.REDIS_URL)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["REDIS_URL"],
          message: "Must be Upstash rediss:// URL on Render (not redis://localhost:6379)",
        });
      }
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
