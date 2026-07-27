import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/routers/_app";
import { createContext } from "@/server/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
    // Required so the client can send queries as POST (avoids HTTP 431 on long GET URLs).
    allowMethodOverride: true,
  });

export { handler as GET, handler as POST };
