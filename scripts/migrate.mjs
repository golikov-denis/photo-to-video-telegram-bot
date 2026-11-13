import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required in .env");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const lockId = 741_852_963;

try {
  await sql`SELECT pg_advisory_lock(${lockId})`;
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  const directory = path.join(process.cwd(), "migrations");
  const files = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  for (const name of files) {
    const applied = await sql`SELECT name FROM schema_migrations WHERE name = ${name}`;
    if (applied.length) continue;
    const contents = await readFile(path.join(directory, name), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(contents);
      await transaction`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
    console.log(`Applied ${name}`);
  }
  console.log("Migrations are up to date.");
} finally {
  await sql`SELECT pg_advisory_unlock(${lockId})`.catch(() => undefined);
  await sql.end();
}
