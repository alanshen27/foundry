import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { User } from "@foundry/db";
import { getCurrentUser } from "./session";

export type Context = {
  user: User | null;
};

export async function createContext(): Promise<Context> {
  return { user: await getCurrentUser() };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape }) {
    // Intentional TRPC errors carry user-safe validation/capability messages.
    // Unexpected exceptions may contain database details, absolute paths,
    // environment names, provider responses, or secrets and are never public.
    if (shape.data.code === "INTERNAL_SERVER_ERROR") {
      return {
        ...shape,
        message:
          "The request could not be completed. Try again or contact a workspace administrator.",
      };
    }
    if (shape.data.code === "BAD_GATEWAY" || shape.data.code === "TIMEOUT") {
      return {
        ...shape,
        message: "A connected service could not complete the request. Try again shortly.",
      };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { user: ctx.user } });
});
