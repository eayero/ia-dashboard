import { setTimeout as delay } from 'node:timers/promises';
import { Pool, OutboxStore } from '@acc/db';
import { loadOutboxConfiguration } from './config.ts';
import { RedisEventSink } from './redis.ts';
import { OutboxWorker } from './worker.ts';

const controller = new globalThis.AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
let pool: InstanceType<typeof Pool> | undefined, sink: RedisEventSink | undefined;
try {
  const config = loadOutboxConfiguration(process.env);
  pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  });
  await pool.query('SELECT claim_token,locked_until,next_attempt_at FROM event_outbox LIMIT 0');
  await pool.query('SELECT id,expires_at FROM context_snapshots LIMIT 0');
  const store = new OutboxStore(pool);
  sink = new RedisEventSink(config.redisUrl);
  const worker = new OutboxWorker(store, sink);
  let nextCleanup = 0;
  console.log('ACC outbox worker started');
  while (!controller.signal.aborted) {
    try {
      if (Date.now() >= nextCleanup) {
        await store.cleanupExpiredSnapshots();
        nextCleanup = Date.now() + 1000;
      }
      const result = await worker.processOne();
      if (result === 'published' || result === 'leaseLost') continue;
      if (result === 'failed') console.error('Outbox delivery failed; event remains pending');
    } catch {
      console.error('Outbox cycle failed; retrying');
    }
    try {
      await delay(config.pollMs, undefined, { signal: controller.signal });
    } catch {
      if (!controller.signal.aborted) throw new Error('Outbox timer failed');
    }
  }
} catch {
  console.error('Outbox startup failed. Check configuration, migrations and database.');
  process.exitCode = 1;
} finally {
  sink?.close();
  await pool?.end();
}
