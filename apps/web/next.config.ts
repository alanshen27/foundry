import { config } from "dotenv";
import { join } from "node:path";
import type { NextConfig } from "next";

// Load the monorepo-root .env so a single env file serves every package.
// dotenv never overrides variables already set (CI, inline overrides win).
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
  serverExternalPackages: ["@kittycad/lib"],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "monaco-editor/esm/vs/editor/editor.api.js": monacoEditorApi,
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      "monaco-editor/esm/vs/editor/editor.api.js": monacoEditorApi,
    },
  },
};

export default nextConfig;
