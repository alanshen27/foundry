import { config } from "dotenv";
import { join } from "node:path";
import type { NextConfig } from "next";

// Load the monorepo-root .env so a single env file serves every package.
// dotenv never overrides variables already set (CI, inline overrides win).
config({ path: join(__dirname, "..", "..", ".env") });

const nextConfig: NextConfig = {
  transpilePackages: [
    "@foundry/auth",
    "@foundry/config",
    "@foundry/db",
    "@foundry/domain",
    "@foundry/realtime",
    "@foundry/storage",
    "@foundry/observability",
  ],
};

export default nextConfig;
