/**
 * Read-only: inspects a database built with `db push` and prints the
 * `migrate resolve --applied` commands that baseline it, so `migrate deploy`
 * applies only what is genuinely missing. Never writes.
 */
import { PrismaClient } from "@prisma/client";

/** Each migration that `db push` could already have applied, with its marker object. */
const MIGRATIONS: Array<{ name: string; probe: string }> = [
  { name: "0_init", probe: `SELECT to_regclass('public."Project"') IS NOT NULL AS present` },
  {
    name: "20260916000000_product_graph",
    probe: `SELECT to_regclass('public."ProductNode"') IS NOT NULL AS present`,
  },
  {
    name: "20260916010000_chat_run_usage",
    probe: `SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ChatRun'
      AND column_name = 'cachedInputTokens') AS present`,
  },
  {
    name: "20260922032714_graph_proposals",
    probe: `SELECT to_regclass('public."GraphProposal"') IS NOT NULL AS present`,
  },
];

const prisma = new PrismaClient();

async function main() {
  const history = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS present`,
  );
  if (history[0]?.present) {
    console.log("Migration history exists; no baseline needed. Run `pnpm db:migrate:status`.");
    return;
  }
  const present: string[] = [];
  for (const migration of MIGRATIONS) {
    const rows = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(migration.probe);
    if (!rows[0]?.present) break;
    present.push(migration.name);
  }
  if (!present.length) {
    console.log("Empty database; no baseline needed. `pnpm db:migrate:deploy` builds it.");
    return;
  }
  console.log("No migration history. Mark the migrations db push already applied:\n");
  for (const name of present) {
    console.log(`  pnpm --filter @foundry/db exec prisma migrate resolve --applied ${name}`);
  }
  console.log(
    "\nThen `pnpm db:migrate:deploy` applies the rest, and `pnpm db:migrate:check` must" +
      " report no difference.",
  );
}

main().finally(() => prisma.$disconnect());
