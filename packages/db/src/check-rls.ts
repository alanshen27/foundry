/**
 * Fails when any public table lacks row-level security. Supabase serves the
 * public schema to browser-held anon keys, so a new table without RLS is
 * readable by anyone until a migration enables it.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<Array<{ table: string }>>`
    SELECT c.relname AS table
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
    ORDER BY c.relname
  `;
  if (rows.length) {
    console.error(
      `Tables without row-level security: ${rows.map((r) => r.table).join(", ")}\n` +
        `Add ALTER TABLE "<name>" ENABLE ROW LEVEL SECURITY; to the migration that creates them.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("Every public table has row-level security enabled.");
}

main().finally(() => prisma.$disconnect());
