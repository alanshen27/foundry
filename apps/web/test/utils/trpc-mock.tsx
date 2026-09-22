/**
 * A stand-in for `@/lib/trpc` in component tests.
 *
 * Components call `trpc.<router>.<procedure>.useQuery / useMutation` and
 * `trpc.useUtils()`. Wiring a real tRPC client, React Query and a server for
 * each component test would test the plumbing, not the component, so this
 * answers queries from a table the test controls and records mutations.
 *
 * Mutations are real hooks — `isPending`, `data` and `error` update and
 * re-render exactly as React Query's would — so a component's pending and
 * success states can be asserted.
 */

import { useState } from "react";
import { vi } from "vitest";

type QueryResult = {
  data?: unknown;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: { message: string } | null;
};

export type TrpcMock = ReturnType<typeof createTrpcMock>;

export function createTrpcMock() {
  const queries = new Map<string, QueryResult | ((input: unknown) => QueryResult)>();
  const mutationHandlers = new Map<string, (input: unknown) => unknown>();
  const mutationCalls: { path: string; input: unknown }[] = [];
  const queryCalls: { path: string; input: unknown }[] = [];
  const invalidations: { path: string; input: unknown }[] = [];
  /** Imperative `utils.client.<path>.query(input)` calls, answered by handler. */
  const clientQueries = new Map<string, (input: unknown) => unknown>();
  const refetch = vi.fn();

  // React Query hands back the same data object until it refetches, and
  // components key effects on that identity. A fresh object per render would
  // turn any `useEffect(..., [query.data])` into an infinite loop, so results
  // are cached per path and input exactly as the real client caches them.
  const resultCache = new Map<string, QueryResult | undefined>();

  function useQuery(path: string, input: unknown, opts?: { enabled?: boolean }) {
    queryCalls.push({ path, input });
    const cacheKey = `${path}:${JSON.stringify(input)}`;
    if (!resultCache.has(cacheKey)) {
      const entry = queries.get(path);
      resultCache.set(cacheKey, typeof entry === "function" ? entry(input) : entry);
    }
    const result = resultCache.get(cacheKey);
    if (opts?.enabled === false && !result)
      return { data: undefined, isLoading: false, isFetching: false, error: null, refetch };
    return {
      data: result?.data,
      isLoading: result?.isLoading ?? false,
      isFetching: result?.isFetching ?? false,
      error: result?.error ?? null,
      refetch,
    };
  }

  function useMutation(path: string, opts?: { onSuccess?: (data: unknown) => void }) {
    const [state, setState] = useState<{ isPending: boolean; data: unknown; error: unknown }>({
      isPending: false,
      data: undefined,
      error: null,
    });
    const run = async (input: unknown) => {
      mutationCalls.push({ path, input });
      setState((s) => ({ ...s, isPending: true }));
      try {
        const data = await (mutationHandlers.get(path)?.(input) ?? { ok: true });
        setState({ isPending: false, data, error: null });
        opts?.onSuccess?.(data);
        return data;
      } catch (error) {
        setState({ isPending: false, data: undefined, error });
        throw error;
      }
    };
    return {
      ...state,
      mutate: (input: unknown, callOpts?: { onSuccess?: (data: unknown) => void }) =>
        void run(input)
          .then((data) => callOpts?.onSuccess?.(data))
          .catch(() => undefined),
      mutateAsync: run,
    };
  }

  const procedure = (path: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === "useQuery")
            return (input: unknown, opts?: { enabled?: boolean }) => useQuery(path, input, opts);
          if (key === "useMutation")
            return (opts?: { onSuccess?: (d: unknown) => void }) => useMutation(path, opts);
          return procedure(path ? `${path}.${key}` : key);
        },
      },
    );

  const utilsNode = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_t, key: string) => {
        if (key === "query" && path.startsWith("client.")) {
          const procedurePath = path.slice("client.".length);
          return async (input: unknown) => {
            queryCalls.push({ path: procedurePath, input });
            const handler = clientQueries.get(procedurePath);
            if (!handler) throw new Error(`no client query handler for ${procedurePath}`);
            return handler(input);
          };
        }
        if (key === "invalidate") {
          return (input: unknown) => {
            invalidations.push({ path, input });
            return Promise.resolve();
          };
        }
        return utilsNode(path ? `${path}.${key}` : key);
      },
    });

  const trpc = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "useUtils") return () => utilsNode("");
        return procedure(key);
      },
    },
  );

  return {
    trpc,
    /** Answer `path` (e.g. "graph.impact") with a fixed result or a function of input. */
    query(path: string, result: QueryResult | ((input: unknown) => QueryResult)) {
      queries.set(path, result);
      for (const key of [...resultCache.keys()])
        if (key.startsWith(`${path}:`)) resultCache.delete(key);
    },
    /** What a mutation resolves to. Defaults to `{ ok: true }`. */
    mutation(path: string, handler: (input: unknown) => unknown) {
      mutationHandlers.set(path, handler);
    },
    /** Answer an imperative `utils.client.<path>.query`. */
    clientQuery(path: string, handler: (input: unknown) => unknown) {
      clientQueries.set(path, handler);
    },
    mutationCalls,
    queryCalls,
    invalidations,
    refetch,
  };
}
