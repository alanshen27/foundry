"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { useState, type ReactNode } from "react";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers/_app";

export const trpc = createTRPCReact<AppRouter>();

/**
 * tRPC's default GET-for-queries puts input in the URL. Combined with cookies,
 * Node/Next returns 431 with an empty body; then `response.json()` throws
 * "Unexpected end of JSON input". Always POST, and fail clearly on empty bodies.
 */
async function trpcFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 431) {
    throw new Error(
      "Request rejected (HTTP 431 — headers too large). Clear site cookies for localhost:3000 and reload.",
    );
  }
  // Clone so tRPC can still read the body; replace empty error responses with JSON.
  if (!response.ok) {
    const text = await response.clone().text();
    if (!text.trim()) {
      return new Response(
        JSON.stringify([
          {
            error: {
              message: `tRPC request failed (HTTP ${response.status}) with an empty body`,
              code: -32603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: response.status },
            },
          },
        ]),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }
  return response;
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
          methodOverride: "POST",
          fetch: trpcFetch,
        }),
      ],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
