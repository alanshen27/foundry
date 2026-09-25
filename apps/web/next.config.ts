import { config } from "dotenv";
import { join } from "node:path";
import type { NextConfig } from "next";

// Load the monorepo-root env so a single file serves every package.
// dotenv never overrides variables already set (CI, inline overrides win), so
// .env.local goes first: it is the local-dev override, and without it a bare
// `next dev` (e.g. one Playwright starts itself) ran against whatever .env
// holds, which is the production database.
config({ path: join(__dirname, "..", "..", ".env.local") });
config({ path: join(__dirname, "..", "..", ".env") });

// monaco-editor >=0.55 package exports remap `monaco-editor/esm/vs/*` to a
// doubled path. y-monaco (and similar) still deep-import the old form.
const monacoEditorApi = join(__dirname, "node_modules/monaco-editor/esm/vs/editor/editor.api.js");

const nextConfig: NextConfig = {
  // Lets a second instance (tests, agents) run without clobbering the main
  // dev server's build cache: NEXT_DIST_DIR=.next-test pnpm dev --port 3100
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Lint via root `pnpm lint` (CI). Next's build-time ESLint doesn't load our
  // flat config plugins and fails deploys on eslint-disable comments for
  // @next/* / react-hooks/* rules that aren't registered there.
  eslint: { ignoreDuringBuilds: true },
  // Hide the floating Next.js dev-tools badge (bottom corner "N" logo) so
  // dev-server screen recordings look like production.
  devIndicators: false,
  transpilePackages: [
    "@foundry/auth",
    "@foundry/cad",
    "@foundry/collaboration",
    "@foundry/commerce",
    "@foundry/config",
    "@foundry/db",
    "@foundry/domain",
    "@foundry/realtime",
    "@foundry/sites",
    "@foundry/storage",
    "@foundry/observability",
  ],
  // bullmq optionally imports @valkey/valkey-glide; bundling it spams
  // "Module not found" in dev. Keep these as Node requires instead.
  //
  // `ws` must stay external too: bundling breaks its optional `bufferutil`
  // require, so `bufferUtil.mask` is undefined and every client frame throws
  // — Zoo's ML socket connects and then never receives the prompt.
  // @sentry/node relies on OpenTelemetry module patching, which bundling breaks.
  serverExternalPackages: ["@kittycad/lib", "bullmq", "ioredis", "ws", "@sentry/node"],
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "monaco-editor/esm/vs/editor/editor.api.js": monacoEditorApi,
    };
    if (isServer) {
      // `serverExternalPackages` misses `ws` because it is imported from a
      // transpiled workspace package (@foundry/cad), so externalize it here.
      // `ws` is a direct dependency of this app so the require resolves.
      config.externals = [...(config.externals ?? []), { ws: "commonjs ws" }];
    }
    return config;
  },
  turbopack: {
    resolveAlias: {
      "monaco-editor/esm/vs/editor/editor.api.js": monacoEditorApi,
    },
  },
};

export default nextConfig;
