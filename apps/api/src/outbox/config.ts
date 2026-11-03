import { z } from 'zod';
export function loadOutboxConfiguration(env: Record<string, string | undefined>) {
  try {
    const values = z
      .object({
        DATABASE_URL: z.string().min(1),
        REDIS_URL: z.string().min(1),
        OUTBOX_POLL_MS: z.coerce.number().int().min(50).max(30000).default(250),
      })
      .parse(env);
    const database = new URL(values.DATABASE_URL),
      redis = new URL(values.REDIS_URL);
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !['redis:', 'rediss:'].includes(redis.protocol) ||
      redis.hash
    )
      throw new Error();
    return {
      databaseUrl: values.DATABASE_URL,
      redisUrl: values.REDIS_URL,
      pollMs: values.OUTBOX_POLL_MS,
    };
  } catch {
    throw new Error('Invalid outbox configuration');
  }
}
