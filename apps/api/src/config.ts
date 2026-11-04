import { z } from 'zod';

export function loadConfiguration(env: Record<string, string | undefined>) {
  try {
    const values = z
      .object({
        NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
        DATABASE_URL: z.string().min(1),
        REDIS_URL: z.url().optional(),
        SESSION_SECRET: z.string().min(32),
        PUBLIC_ORIGIN: z.url(),
        API_PORT: z.coerce.number().int().min(1).max(65535).default(53000),
        API_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
      })
      .parse(env);
    const origin = new URL(values.PUBLIC_ORIGIN);
    for (const url of [origin]) {
      if (url.username || url.password || url.search || url.hash) throw new Error();
      if (
        url.protocol !== 'https:' &&
        !(
          values.NODE_ENV !== 'production' &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )
      )
        throw new Error();
    }
    if (origin.pathname !== '/') throw new Error();
    const database = new URL(values.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error();
    return {
      nodeEnv: values.NODE_ENV,
      databaseUrl: values.DATABASE_URL,
      redisUrl: values.REDIS_URL,
      sessionSecret: values.SESSION_SECRET,
      publicOrigin: origin.origin,
      port: values.API_PORT,
      host: values.API_HOST,
      secureCookie: values.NODE_ENV === 'production' || origin.protocol === 'https:',
    };
  } catch {
    throw new Error('Invalid API configuration');
  }
}
export type ApiConfiguration = ReturnType<typeof loadConfiguration>;
