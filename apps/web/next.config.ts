import { config } from "dotenv";
import { join } from "node:path";
import type { NextConfig } from "next";

// Load the monorepo-root .env so a single env file serves every package.
// dotenv never overrides variables already set (CI, inline overrides win).
config({ path: join(__dirname, "..", "..", ".env") });

const nextConfig: NextConfig = {
  // Lets a second instance (tests, agents) run without clobbering the main
  // dev server's build cache: NEXT_DIST_DIR=.next-test pnpm dev --port 3100
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: [
    "@foundry/auth",
    "@foundry/cad",
    "@foundry/config",
    "@foundry/db",
    "@foundry/domain",
    "@foundry/realtime",
    "@foundry/storage",
    "@foundry/observability",
  ],
  serverExternalPackages: ["@kittycad/lib"],
};

export default nextConfig;
