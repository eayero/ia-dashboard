import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const migrationDirectory = new URL('../migrations/', import.meta.url);
export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('acc:migrations:' || current_schema(), 0))",
    );
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())',
    );
    const files = (await readdir(migrationDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
      .sort();
    for (const name of files) {
      const sql = await readFile(new URL(name, migrationDirectory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE name=$1',
        [name],
      );
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum)
          throw new Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1,$2)', [
        name,
        checksum,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await migrate(pool);
    console.log(`Migrations applied from ${fileURLToPath(migrationDirectory)}`);
  } catch {
    console.error('Database migration failed; no pending migration was committed.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
